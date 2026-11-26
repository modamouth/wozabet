import { AppError } from '../errors';
import type { PaymentProvider } from './types';
import { mobileWalletProvider } from './mobileWallet';
import { sandboxProvider } from './sandbox';

/** The provider chosen by PAYMENTS_PROVIDER. Empty = deposits switched off (the default). */
export function getPaymentProvider(env: Record<string, string | undefined> = process.env): PaymentProvider | null {
  const which = (env.PAYMENTS_PROVIDER ?? '').trim();
  if (!which) return null;
  const secret = env.PAYMENT_WEBHOOK_SECRET ?? '';
  if (!secret) throw new AppError('payments_misconfigured', 'Payments are not configured', 503);
  if (which === 'sandbox') {
    if (env.NODE_ENV === 'production') throw new AppError('payments_misconfigured', 'The sandbox payment provider cannot run in production', 503);
    return sandboxProvider(secret);
  }
  if (which === 'mobile_wallet') {
    const { MOBILE_WALLET_API_URL: apiUrl = '', MOBILE_WALLET_API_KEY: apiKey = '', MOBILE_WALLET_MERCHANT_ID: merchantId = '' } = env;
    if (!apiUrl || !apiKey || !merchantId) throw new AppError('payments_misconfigured', 'Payments are not configured', 503);
    return mobileWalletProvider({ apiUrl, apiKey, merchantId, webhookSecret: secret });
  }
  throw new AppError('payments_misconfigured', `Unknown PAYMENTS_PROVIDER "${which}"`, 503);
}

export function webhookUrl(provider: PaymentProvider, env: Record<string, string | undefined> = process.env): string {
  const base = (env.PUBLIC_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/api/payments/webhook/${provider.name}`;
}

export type { PaymentProvider, PaymentEvent, CollectionRequest } from './types';
