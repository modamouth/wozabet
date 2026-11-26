import type { PaymentProvider } from './types';
import { mobileWalletProvider } from './mobileWallet';

/**
 * Local test provider: it never calls out and never credits anyone by itself. A deposit only lands when a correctly
 * signed webhook arrives (send one with `npm run sandbox:webhook`). Blocked in production.
 */
export function sandboxProvider(webhookSecret: string): PaymentProvider {
  const base = mobileWalletProvider({ apiUrl: 'http://sandbox.invalid', apiKey: '', merchantId: 'sandbox', webhookSecret, name: 'sandbox' });
  return {
    ...base,
    async initiateCollection(req) {
      return { providerRef: `sbx-${req.reference}` };
    },
  };
}
