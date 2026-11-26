import { describe, it, expect, beforeEach } from 'vitest';
import type { Db } from '@/lib/db';
import { credit, getBalance } from '@/lib/wallet';
import { placeBet } from '@/lib/bets';
import { setResultAndSettle } from '@/lib/settle';
import { syncFixtures } from '@/lib/sync';
import { mockProvider } from '@/lib/providers/mock';
import { sandboxProvider } from '@/lib/payments/sandbox';
import { initiateDeposit, applyPaymentEvent } from '@/lib/payments/service';
import { setLimit, currentLimit, startCoolOff, selfExclude, setSessionReminder, rgOverview, netLossInWindow, LIMIT_INCREASE_DELAY_HOURS } from '@/lib/rg';
import { freshDb, makeUser, withdrawWithOtp } from './helpers';

const DATE = '2026-11-26';
const H = 3_600_000;
const provider = sandboxProvider('s');
const cb = 'http://x/cb';
let db: Db;
let uid: string;

const price = async (fid: string, sel: string) => (await db.q<{ price_milli: number }>("SELECT price_milli FROM odds WHERE fixture_id=$1 AND market='1x2' AND selection=$2", [fid, sel]))[0].price_milli;
const bet = async (stakeCents: number, fid = `mock-${DATE}-1`, sel = '1') => placeBet(db, uid, { stakeCents, selections: [{ fixtureId: fid, market: '1x2', selection: sel, priceMilli: await price(fid, sel) }] });
const dep = (amountCents: number) => initiateDeposit(db, provider, { userId: uid, amountCents, callbackUrl: cb });

beforeEach(async () => {
  db = await freshDb();
  await syncFixtures(db, [mockProvider()], [DATE]);
  uid = (await makeUser(db)).id;
  await credit(db.q, uid, 100_000, 'deposit', 'seed');
  await db.q("UPDATE ledger SET created_at = now() - interval '60 days' WHERE ref='seed'"); // outside every window
});

describe('limit changes', () => {
  it('tightening applies now; loosening or removing waits 24 hours; latest change wins', async () => {
    const t0 = new Date();
    await setLimit(db, uid, 'deposit', 'day', 50_000, t0);
    expect((await currentLimit(db.q, uid, 'deposit', 'day', t0)).amountCents).toBe(50_000);

    const raise = await setLimit(db, uid, 'deposit', 'day', 80_000, t0);
    expect(raise.delayed).toBe(true);
    const st = await currentLimit(db.q, uid, 'deposit', 'day', t0);
    expect(st).toMatchObject({ amountCents: 50_000, pending: { amountCents: 80_000 } });
    expect((await currentLimit(db.q, uid, 'deposit', 'day', new Date(t0.getTime() + LIMIT_INCREASE_DELAY_HOURS * H + 1))).amountCents).toBe(80_000);

    // lowering again cancels the pending increase
    await setLimit(db, uid, 'deposit', 'day', 30_000, t0);
    expect((await currentLimit(db.q, uid, 'deposit', 'day', new Date(t0.getTime() + 48 * H))).amountCents).toBe(30_000);

    expect((await setLimit(db, uid, 'deposit', 'day', null, t0)).delayed).toBe(true);
    expect((await currentLimit(db.q, uid, 'deposit', 'day', t0)).amountCents).toBe(30_000);
    expect((await currentLimit(db.q, uid, 'deposit', 'day', new Date(t0.getTime() + 25 * H))).amountCents).toBeNull();
    await expect(setLimit(db, uid, 'deposit', 'day', 50, t0)).rejects.toMatchObject({ code: 'bad_amount' });
    await expect(setLimit(db, uid, 'deposit', 'day', 100.5, t0)).rejects.toMatchObject({ code: 'bad_amount' });
  });
});

describe('deposit limits', () => {
  it('blocks deposits over any window, counting pending payments too', async () => {
    await setLimit(db, uid, 'deposit', 'day', 30_000);
    await setLimit(db, uid, 'deposit', 'month', 50_000);
    const a = await dep(20_000);
    await expect(dep(15_000)).rejects.toMatchObject({ code: 'deposit_limit' }); // 20k pending + 15k > 30k daily
    expect((await dep(10_000)).status).toBe('pending');
    // completing the pending ones doesn't change the count
    await applyPaymentEvent(db, 'sandbox', { reference: a.id, providerRef: `sbx-${a.id}`, status: 'succeeded', amountCents: 20_000, currency: 'NAD' });
    await expect(dep(1_000)).rejects.toMatchObject({ code: 'deposit_limit' });
    // a day later the daily window is free but the monthly one still counts
    await db.q("UPDATE ledger SET created_at = now() - interval '2 days' WHERE type='deposit' AND ref<>'seed'");
    await db.q("UPDATE payments SET created_at = now() - interval '2 days'");
    expect((await dep(20_000)).status).toBe('pending');
    await expect(dep(1_000)).rejects.toMatchObject({ code: 'deposit_limit', message: expect.stringContaining('monthly') });
  });
  it('failed payments free up the limit', async () => {
    await setLimit(db, uid, 'deposit', 'day', 20_000);
    const a = await dep(20_000);
    await applyPaymentEvent(db, 'sandbox', { reference: a.id, providerRef: `sbx-${a.id}`, status: 'failed', amountCents: 20_000, currency: 'NAD' });
    expect((await dep(20_000)).status).toBe('pending');
  });
});

describe('loss limits', () => {
  it('counts stakes minus returns and blocks stakes that could exceed the limit', async () => {
    await setLimit(db, uid, 'loss', 'day', 10_000);
    await bet(6_000);
    await expect(bet(5_000, `mock-${DATE}-2`)).rejects.toMatchObject({ code: 'loss_limit' });
    expect(await getBalance(db.q, uid)).toBe(94_000); // rejected bet took nothing
    await bet(4_000, `mock-${DATE}-2`);
    // first bet wins: winnings reduce the net loss
    await setResultAndSettle(db, `mock-${DATE}-1`, { status: 'finished', homeScore: 2, awayScore: 0 });
    const loss = await netLossInWindow(db.q, uid, 'day');
    expect(loss).toBeLessThan(10_000 - 6_000);
    expect((await bet(1_000, `mock-${DATE}-3`)).stakeCents).toBe(1_000);
  });
});

describe('cool-off and self-exclusion', () => {
  it('cool-off blocks bets and deposits but not withdrawals, and cannot be shortened', async () => {
    const r1 = await startCoolOff(db, uid, '7d');
    const r2 = await startCoolOff(db, uid, '24h');
    expect(r2.until).toBe(r1.until);
    await expect(bet(1_000)).rejects.toMatchObject({ code: 'cooling_off' });
    await expect(dep(5_000)).rejects.toMatchObject({ code: 'cooling_off' });
    await db.q("UPDATE users SET kyc_status='verified' WHERE id=$1", [uid]);
    expect((await withdrawWithOtp(db, uid, 10_000)).status).toBe('pending');
  });
  it('time-limited exclusion lasts the chosen months and can only be extended', async () => {
    const now = new Date('2026-11-26T10:00:00Z');
    const six = await selfExclude(db, uid, '6m', now);
    expect(six.until).toBe('2027-05-26T10:00:00.000Z');
    expect((await selfExclude(db, uid, '1m', now)).until).toBe('2027-05-26T10:00:00.000Z');
    await expect(bet(1_000)).rejects.toMatchObject({ code: 'self_excluded' });
    await expect(dep(5_000)).rejects.toMatchObject({ code: 'self_excluded' });
  });
  it('permanent exclusion blocks forever', async () => {
    await selfExclude(db, uid, 'permanent');
    await db.q('UPDATE users SET self_excluded_until=NULL WHERE id=$1', [uid]);
    await expect(bet(1_000)).rejects.toMatchObject({ code: 'self_excluded', message: expect.stringContaining('permanently') });
    expect((await rgOverview(db, uid)).selfExcludedPermanent).toBe(true);
  });
  it('an expired exclusion no longer blocks', async () => {
    await db.q("UPDATE users SET self_excluded_until = now() - interval '1 minute' WHERE id=$1", [uid]);
    expect((await bet(1_000)).stakeCents).toBe(1_000);
  });
});

describe('session reminder', () => {
  it('accepts only the offered intervals', async () => {
    await setSessionReminder(db, uid, 30);
    expect((await rgOverview(db, uid)).sessionReminderMinutes).toBe(30);
    await expect(setSessionReminder(db, uid, 7)).rejects.toMatchObject({ code: 'bad_option' });
    await setSessionReminder(db, uid, null);
    expect((await rgOverview(db, uid)).sessionReminderMinutes).toBeNull();
  });
});
