import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Db } from '@/lib/db';
import { getBalance, credit } from '@/lib/wallet';
import { parseNadToCents } from '@/lib/money';
import { signPayload, verifyHmac } from '@/lib/payments/signature';
import { sandboxProvider } from '@/lib/payments/sandbox';
import { mobileWalletProvider } from '@/lib/payments/mobileWallet';
import { getPaymentProvider } from '@/lib/payments';
import { applyPaymentEvent, initiateDeposit } from '@/lib/payments/service';
import { reviewWithdrawal, listWithdrawals } from '@/lib/withdrawals';
import type { PaymentProvider } from '@/lib/payments/types';
import { freshDb, makeUser, ledgerSum, withdrawWithOtp } from './helpers';

const SECRET = 'test-webhook-secret';
const limits = { minCents: 1_000, maxCents: 500_000 };
let db: Db;
const provider = sandboxProvider(SECRET);
const cb = 'http://localhost/api/payments/webhook/sandbox';

beforeEach(async () => { db = await freshDb(); });

describe('money parsing', () => {
  it('parses N$ strings to cents without floats', () => {
    expect(parseNadToCents('150')).toBe(15_000);
    expect(parseNadToCents('150.5')).toBe(15_050);
    expect(parseNadToCents('N$ 1 250,05')).toBe(125_005);
    expect(parseNadToCents('0.29')).toBe(29); // 0.29*100 = 28.999… in floats
    expect(parseNadToCents('1.005')).toBeNull();
    expect(parseNadToCents('-5')).toBeNull();
    expect(parseNadToCents('abc')).toBeNull();
  });
});

describe('webhook signatures', () => {
  const now = new Date('2026-11-26T12:00:00Z');
  const ts = Math.floor(now.getTime() / 1000);
  const body = '{"a":1}';
  it('accepts a valid signature and rejects tampering, wrong secret, stale or malformed headers', () => {
    const sig = signPayload(SECRET, ts, body);
    expect(verifyHmac(SECRET, body, String(ts), sig, now)).toBe(true);
    expect(verifyHmac(SECRET, '{"a":2}', String(ts), sig, now)).toBe(false);
    expect(verifyHmac('other', body, String(ts), sig, now)).toBe(false);
    expect(verifyHmac(SECRET, body, String(ts - 301), signPayload(SECRET, ts - 301, body), now)).toBe(false);
    expect(verifyHmac(SECRET, body, String(ts), sig.slice(0, 10), now)).toBe(false);
    expect(verifyHmac(SECRET, body, null, sig, now)).toBe(false);
    expect(verifyHmac('', body, String(ts), signPayload('', ts, body), now)).toBe(false);
  });
});

describe('provider selection', () => {
  it('is off by default and refuses unsafe configs', () => {
    expect(getPaymentProvider({})).toBeNull();
    expect(() => getPaymentProvider({ PAYMENTS_PROVIDER: 'sandbox' })).toThrow();
    expect(() => getPaymentProvider({ PAYMENTS_PROVIDER: 'sandbox', PAYMENT_WEBHOOK_SECRET: 'x', NODE_ENV: 'production' })).toThrow();
    expect(getPaymentProvider({ PAYMENTS_PROVIDER: 'sandbox', PAYMENT_WEBHOOK_SECRET: 'x' })!.name).toBe('sandbox');
    expect(() => getPaymentProvider({ PAYMENTS_PROVIDER: 'mobile_wallet', PAYMENT_WEBHOOK_SECRET: 'x' })).toThrow();
    expect(() => getPaymentProvider({ PAYMENTS_PROVIDER: 'paypal', PAYMENT_WEBHOOK_SECRET: 'x' })).toThrow();
  });
  it('mobile wallet adapter sends the request and parses callbacks', async () => {
    let sent: any;
    const p = mobileWalletProvider({
      apiUrl: 'https://wallet.example/api/', apiKey: 'k', merchantId: 'm', webhookSecret: SECRET,
      fetchImpl: (async (url: string, init: any) => { sent = { url, body: JSON.parse(init.body) }; return new Response(JSON.stringify({ transactionId: 'tx-9' })); }) as any,
    });
    expect(await p.initiateCollection({ reference: 'r1', amountCents: 5000, msisdn: '264811', callbackUrl: cb })).toEqual({ providerRef: 'tx-9' });
    expect(sent.url).toBe('https://wallet.example/api/collections');
    expect(sent.body).toMatchObject({ reference: 'r1', amount: 5000, currency: 'NAD', msisdn: '264811' });
    expect(p.parseWebhook(JSON.stringify({ reference: 'r1', transactionId: 'tx-9', status: 'SUCCESS', amount: 5000, currency: 'nad' })))
      .toEqual({ reference: 'r1', providerRef: 'tx-9', status: 'succeeded', amountCents: 5000, currency: 'NAD', failureReason: undefined });
    expect(() => p.parseWebhook(JSON.stringify({ reference: 'r1', status: 'SUCCESS', amount: 50.5, currency: 'NAD' }))).toThrow();
  });
});

describe('deposits', () => {
  it('initiation validates the amount, records a pending payment and credits nothing', async () => {
    const u = await makeUser(db);
    await expect(initiateDeposit(db, provider, { userId: u.id, amountCents: 999, callbackUrl: cb, limits })).rejects.toMatchObject({ code: 'deposit_too_low' });
    await expect(initiateDeposit(db, provider, { userId: u.id, amountCents: 500_001, callbackUrl: cb, limits })).rejects.toMatchObject({ code: 'deposit_too_high' });
    await expect(initiateDeposit(db, provider, { userId: u.id, amountCents: 10.5, callbackUrl: cb, limits })).rejects.toMatchObject({ code: 'bad_amount' });
    const p = await initiateDeposit(db, provider, { userId: u.id, amountCents: 20_000, callbackUrl: cb, limits });
    const row = (await db.q('SELECT * FROM payments WHERE id=$1', [p.id]))[0];
    expect(row).toMatchObject({ status: 'pending', amount_cents: 20_000, provider_ref: `sbx-${p.id}`, msisdn: u.phone.slice(1) });
    expect(await getBalance(db.q, u.id)).toBe(0);
  });

  it('marks the payment failed when the provider is unreachable', async () => {
    const u = await makeUser(db);
    const broken: PaymentProvider = { ...provider, initiateCollection: async () => { throw new Error('ECONNREFUSED'); } };
    await expect(initiateDeposit(db, broken, { userId: u.id, amountCents: 5_000, callbackUrl: cb, limits })).rejects.toMatchObject({ code: 'provider_unavailable', status: 502 });
    expect((await db.q("SELECT status FROM payments"))[0].status).toBe('failed');
  });

  it('a success webhook credits exactly once, with the provider reference in the ledger', async () => {
    const u = await makeUser(db);
    const p = await initiateDeposit(db, provider, { userId: u.id, amountCents: 20_000, callbackUrl: cb, limits });
    const ev = { reference: p.id, providerRef: `sbx-${p.id}`, status: 'succeeded' as const, amountCents: 20_000, currency: 'NAD' };
    expect(await applyPaymentEvent(db, 'sandbox', ev)).toMatchObject({ status: 'completed', changed: true });
    expect(await applyPaymentEvent(db, 'sandbox', ev)).toMatchObject({ status: 'completed', changed: false });
    expect(await getBalance(db.q, u.id)).toBe(20_000);
    expect(await db.q('SELECT type, amount_cents, ref FROM ledger WHERE user_id=$1', [u.id])).toEqual([{ type: 'deposit', amount_cents: 20_000, ref: `sandbox:sbx-${p.id}` }]);
  });

  it('parks mismatched or contradictory events in review without crediting', async () => {
    const u = await makeUser(db);
    const mk = () => initiateDeposit(db, provider, { userId: u.id, amountCents: 20_000, callbackUrl: cb, limits });
    const a = await mk(), b = await mk(), c = await mk(), d = await mk();
    const ok = (id: string) => ({ reference: id, providerRef: `sbx-${id}`, status: 'succeeded' as const, amountCents: 20_000, currency: 'NAD' });
    expect((await applyPaymentEvent(db, 'sandbox', { ...ok(a.id), amountCents: 2_000_000 })).status).toBe('review');
    expect((await applyPaymentEvent(db, 'sandbox', { ...ok(b.id), currency: 'ZAR' })).status).toBe('review');
    expect((await applyPaymentEvent(db, 'sandbox', { ...ok(c.id), providerRef: 'someone-elses-tx' })).status).toBe('review');
    expect((await applyPaymentEvent(db, 'sandbox', { ...ok(d.id), status: 'failed', failureReason: 'cancelled by user' })).status).toBe('failed');
    expect((await applyPaymentEvent(db, 'sandbox', ok(d.id))).status).toBe('review');
    // a review row is final for the webhook: a later "correct" event must not credit it automatically
    expect((await applyPaymentEvent(db, 'sandbox', ok(a.id))).changed).toBe(false);
    expect(await getBalance(db.q, u.id)).toBe(0);
  });

  it('rejects unknown references and events for another provider', async () => {
    const u = await makeUser(db);
    const p = await initiateDeposit(db, provider, { userId: u.id, amountCents: 5_000, callbackUrl: cb, limits });
    const ev = { reference: p.id, providerRef: `sbx-${p.id}`, status: 'succeeded' as const, amountCents: 5_000, currency: 'NAD' };
    await expect(applyPaymentEvent(db, 'mobile_wallet', ev)).rejects.toMatchObject({ code: 'unknown_payment' });
    await expect(applyPaymentEvent(db, 'sandbox', { ...ev, reference: 'nope' })).rejects.toMatchObject({ code: 'unknown_payment' });
  });
});

describe('webhook route', () => {
  const env = { ...process.env };
  beforeEach(() => { process.env.PAYMENTS_PROVIDER = 'sandbox'; process.env.PAYMENT_WEBHOOK_SECRET = SECRET; });
  afterEach(() => { process.env = { ...env }; });

  async function call(body: string, headers: Record<string, string>, name = 'sandbox') {
    const { POST } = await import('@/app/api/payments/webhook/[provider]/route');
    return POST(new Request(`http://localhost/api/payments/webhook/${name}`, { method: 'POST', body, headers }), { params: Promise.resolve({ provider: name }) });
  }
  const signed = (body: string, secret = SECRET) => {
    const ts = Math.floor(Date.now() / 1000);
    return { 'x-timestamp': String(ts), 'x-signature': signPayload(secret, ts, body) };
  };

  it('verifies the signature on the raw body and credits once', async () => {
    const u = await makeUser(db);
    const p = await initiateDeposit(db, provider, { userId: u.id, amountCents: 15_000, callbackUrl: cb, limits });
    const body = JSON.stringify({ reference: p.id, transactionId: `sbx-${p.id}`, status: 'SUCCESS', amount: 15_000, currency: 'NAD' });
    expect((await call(body, signed(body, 'forged'))).status).toBe(401);
    expect((await call(body, {})).status).toBe(401);
    expect((await call(body, signed(body), 'mobile_wallet')).status).toBe(404);
    expect(await getBalance(db.q, u.id)).toBe(0);
    const r1 = await call(body, signed(body));
    expect(r1.status).toBe(200);
    expect((await call(body, signed(body))).status).toBe(200); // provider retry
    expect(await getBalance(db.q, u.id)).toBe(15_000);
    const bad = '{"reference":1}';
    expect((await call(bad, signed(bad))).status).toBe(400);
  });

  it('is disabled when no provider is configured', async () => {
    delete process.env.PAYMENTS_PROVIDER;
    expect((await call('{}', signed('{}'))).status).toBe(404);
  });
});

describe('withdrawals', () => {
  const wl = { minCents: 5_000, maxCents: 2_000_000 };
  it('requires KYC verification', async () => {
    const u = await makeUser(db);
    await credit(db.q, u.id, 50_000, 'deposit', 'd1');
    await expect(withdrawWithOtp(db, u.id, 10_000, wl)).rejects.toMatchObject({ code: 'kyc_required', status: 403 });
    expect(await getBalance(db.q, u.id)).toBe(50_000);
  });

  it('holds the funds while pending; approve keeps them out, reject refunds; each decided once', async () => {
    const admin = await makeUser(db, { role: 'admin' });
    const u = await makeUser(db, { kyc: 'verified' });
    await credit(db.q, u.id, 50_000, 'deposit', 'd1');
    await expect(withdrawWithOtp(db, u.id, 4_999, wl)).rejects.toMatchObject({ code: 'withdrawal_too_low' });
    await expect(withdrawWithOtp(db, u.id, 60_000, wl)).rejects.toMatchObject({ code: 'insufficient_funds' });

    const w1 = await withdrawWithOtp(db, u.id, 20_000, wl);
    const w2 = await withdrawWithOtp(db, u.id, 10_000, wl);
    expect(await getBalance(db.q, u.id)).toBe(20_000);
    expect((await listWithdrawals(db, { status: 'pending' })).map((w) => w.id).sort()).toEqual([w1.id, w2.id].sort());

    await expect(reviewWithdrawal(db, admin.id, w2.id, { action: 'reject', reason: ' ' })).rejects.toMatchObject({ code: 'reason_required' });
    expect(await reviewWithdrawal(db, admin.id, w1.id, { action: 'approve' })).toMatchObject({ status: 'approved' });
    expect(await reviewWithdrawal(db, admin.id, w2.id, { action: 'reject', reason: 'Name mismatch' })).toMatchObject({ status: 'rejected' });
    await expect(reviewWithdrawal(db, admin.id, w2.id, { action: 'reject', reason: 'again' })).rejects.toMatchObject({ code: 'not_pending' });
    await expect(reviewWithdrawal(db, admin.id, w1.id, { action: 'reject', reason: 'oops' })).rejects.toMatchObject({ code: 'not_pending' });

    expect(await getBalance(db.q, u.id)).toBe(30_000);
    expect(await ledgerSum(db, u.id)).toBe(30_000);
    const led = await db.q<any>('SELECT type, amount_cents, ref FROM ledger WHERE user_id=$1 ORDER BY id', [u.id]);
    expect(led.map((l: any) => [l.type, l.amount_cents])).toEqual([['deposit', 50_000], ['withdrawal', -20_000], ['withdrawal', -10_000], ['withdrawal_reversal', 10_000]]);
  });

  it('an admin cannot approve their own withdrawal', async () => {
    const admin = await makeUser(db, { role: 'admin', kyc: 'verified' });
    await credit(db.q, admin.id, 50_000, 'deposit', 'd1');
    const w = await withdrawWithOtp(db, admin.id, 10_000, wl);
    await expect(reviewWithdrawal(db, admin.id, w.id, { action: 'approve' })).rejects.toMatchObject({ code: 'forbidden' });
  });
});
