/**
 * Dev helper: simulate the provider confirming a SANDBOX deposit.
 *   npm run sandbox:webhook -- <paymentId> <amountCents> [SUCCESS|FAILED]
 * Needs PAYMENTS_PROVIDER=sandbox and the same PAYMENT_WEBHOOK_SECRET as the running app.
 */
import { signPayload } from '../src/lib/payments/signature';

async function main() {
  const [reference, amount, status = 'SUCCESS'] = process.argv.slice(2);
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!reference || !amount || !secret) {
    console.error('usage: npm run sandbox:webhook -- <paymentId> <amountCents> [SUCCESS|FAILED]  (PAYMENT_WEBHOOK_SECRET must be set)');
    process.exit(1);
  }
  const body = JSON.stringify({ reference, transactionId: `sbx-${reference}`, status, amount: Number(amount), currency: 'NAD' });
  const ts = Math.floor(Date.now() / 1000);
  const base = (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const res = await fetch(`${base}/api/payments/webhook/sandbox`, {
    method: 'POST', body, headers: { 'content-type': 'application/json', 'x-timestamp': String(ts), 'x-signature': signPayload(secret, ts, body) },
  });
  console.log(res.status, await res.text());
}
main();
