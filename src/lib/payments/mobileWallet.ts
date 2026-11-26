import { z } from 'zod';
import type { CollectionRequest, PaymentEvent, PaymentProvider } from './types';
import { verifyHmac } from './signature';

/**
 * Generic mobile-wallet adapter (push-to-phone collection + signed webhook).
 *
 * IMPORTANT: no Namibian wallet's merchant API was available when this was written. The request path, body
 * fields, signature headers and webhook fields below are ASSUMPTIONS marked `PROVIDER-SPECIFIC`. Check each one
 * against your provider's merchant docs/sandbox before going live. The rest of the payment flow (payment rows,
 * idempotent ledger booking, amount checks) does not depend on these details.
 */
export interface MobileWalletConfig {
  apiUrl: string;
  apiKey: string;
  merchantId: string;
  webhookSecret: string;
  name?: string;
  fetchImpl?: typeof fetch;
}

const Webhook = z.object({
  // PROVIDER-SPECIFIC: field names in the provider's callback body
  reference: z.string().min(1).max(100),
  transactionId: z.string().min(1).max(100),
  status: z.enum(['SUCCESS', 'FAILED']),
  amount: z.number().int().positive(), // cents
  currency: z.string().length(3),
  reason: z.string().max(500).optional(),
});

export function mobileWalletProvider(cfg: MobileWalletConfig): PaymentProvider {
  const doFetch = cfg.fetchImpl ?? fetch;
  return {
    name: cfg.name ?? 'mobile_wallet',
    async initiateCollection(req: CollectionRequest) {
      // PROVIDER-SPECIFIC: endpoint, auth header and body
      const res = await doFetch(`${cfg.apiUrl.replace(/\/$/, '')}/collections`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          merchantId: cfg.merchantId, reference: req.reference, amount: req.amountCents, currency: 'NAD',
          msisdn: req.msisdn, callbackUrl: req.callbackUrl,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`provider returned HTTP ${res.status}`);
      const body = (await res.json().catch(() => ({}))) as { transactionId?: unknown };
      return { providerRef: typeof body.transactionId === 'string' ? body.transactionId : null };
    },
    verifyWebhook(rawBody, headers, now) {
      // PROVIDER-SPECIFIC: header names and signing scheme
      return verifyHmac(cfg.webhookSecret, rawBody, headers.get('x-timestamp'), headers.get('x-signature'), now);
    },
    parseWebhook(rawBody): PaymentEvent {
      const w = Webhook.parse(JSON.parse(rawBody));
      return {
        reference: w.reference, providerRef: w.transactionId, status: w.status === 'SUCCESS' ? 'succeeded' : 'failed',
        amountCents: w.amount, currency: w.currency.toUpperCase(), failureReason: w.reason,
      };
    },
  };
}
