import { describe, it, expect, beforeEach } from 'vitest';
import { createPgliteDb, type Db } from '@/lib/db';
import { createUser, authenticate } from '@/lib/users';
import { credit, deposit, getBalance } from '@/lib/wallet';
import { placeBet, listBets } from '@/lib/bets';
import { setResultAndSettle } from '@/lib/settle';
import { syncFixtures } from '@/lib/sync';
import { mockProvider } from '@/lib/providers/mock';
import { listMatches } from '@/lib/fixtures';

let db: Db;
let uid: string;
const DATE = '2026-11-26';

async function priceOf(fixtureId: string, sel: string) {
  const r = await db.q<{ price_milli: number }>("SELECT price_milli FROM odds WHERE fixture_id=$1 AND market='1x2' AND selection=$2", [fixtureId, sel]);
  return r[0].price_milli;
}

beforeEach(async () => {
  db = await createPgliteDb();
  await syncFixtures(db, [mockProvider()], [DATE]);
  const u = await createUser(db, { phone: '0812345678', password: 'secret-pass', firstName: 'Test', lastName: 'Player', dob: '1990-05-01' });
  uid = u.id;
  await credit(db.q, uid, 100_000, 'deposit', 'dep-1'); // N$1000
});

describe('accounts', () => {
  it('rejects under-18s, duplicates, weak passwords; authenticates', async () => {
    await expect(createUser(db, { phone: '0819999999', password: 'secret-pass', firstName: 'A', lastName: 'B', dob: '2015-01-01' })).rejects.toMatchObject({ code: 'underage' });
    await expect(createUser(db, { phone: '+264812345678', password: 'secret-pass', firstName: 'A', lastName: 'B', dob: '1990-01-01' })).rejects.toMatchObject({ code: 'phone_taken' });
    await expect(createUser(db, { phone: '0819999998', password: 'short', firstName: 'A', lastName: 'B', dob: '1990-01-01' })).rejects.toMatchObject({ code: 'weak_password' });
    expect((await authenticate(db, '081 234 5678', 'secret-pass')).id).toBe(uid);
    await expect(authenticate(db, '0812345678', 'wrong')).rejects.toMatchObject({ code: 'bad_credentials' });
  });
  it('deposits are idempotent by reference', async () => {
    await expect(deposit(db, uid, 100_000, 'dep-1')).rejects.toMatchObject({ code: 'duplicate_ref' });
    expect(await getBalance(db.q, uid)).toBe(100_000);
  });
});

describe('odds feed', () => {
  it('lists scheduled matches with our margin applied and hides live ones from the main list', async () => {
    const m = await listMatches(db, { sport: 'Football' });
    expect(m.length).toBe(5);
    expect(m.every((x) => x.status === 'scheduled')).toBe(true);
    const arsenal = m.find((x) => x.home === 'Arsenal')!;
    expect(arsenal.odds.map((o) => `${o.market}:${o.selection}`)).toEqual(['1x2:1', '1x2:X', '1x2:2', 'dc:1X', 'dc:12', 'dc:X2', 'ou25:O', 'ou25:U', 'btts:Y', 'btts:N']);
    const live = await listMatches(db, { live: true });
    expect(live.length).toBe(1);
    expect(live[0].odds.every((o) => o.suspended)).toBe(true); // live betting is off by default
  });
});

describe('placing bets', () => {
  it('places a single, debits the wallet, writes the ledger', async () => {
    const fid = `mock-${DATE}-1`;
    const price = await priceOf(fid, '1');
    const bet = await placeBet(db, uid, { stakeCents: 5000, selections: [{ fixtureId: fid, market: '1x2', selection: '1', priceMilli: price }] });
    expect(bet.potentialReturnCents).toBe(Math.floor((5000 * price) / 1000));
    expect(await getBalance(db.q, uid)).toBe(95_000);
    const led = await db.q<{ type: string; amount_cents: number }>("SELECT type, amount_cents FROM ledger WHERE user_id=$1 AND type='bet_stake'", [uid]);
    expect(led).toEqual([{ type: 'bet_stake', amount_cents: -5000 }]);
  });
  it('rejects stale prices with the new price, unavailable/live matches, same-match picks, bad stakes, no funds', async () => {
    const fid = `mock-${DATE}-1`;
    const price = await priceOf(fid, '1');
    await expect(placeBet(db, uid, { stakeCents: 5000, selections: [{ fixtureId: fid, market: '1x2', selection: '1', priceMilli: price + 50 }] }))
      .rejects.toMatchObject({ code: 'price_changed', data: { changed: [{ fixtureId: fid, market: '1x2', selection: '1', priceMilli: price }] } });
    const live = `mock-${DATE}-9`;
    await expect(placeBet(db, uid, { stakeCents: 5000, selections: [{ fixtureId: live, market: '1x2', selection: '1', priceMilli: await priceOf(live, '1') }] }))
      .rejects.toMatchObject({ code: 'unavailable' });
    await expect(placeBet(db, uid, { stakeCents: 5000, selections: [{ fixtureId: fid, market: 'ou25', selection: '1', priceMilli: price }] }))
      .rejects.toMatchObject({ code: 'bad_selections' });
    await expect(placeBet(db, uid, { stakeCents: 5000, selections: [{ fixtureId: fid, market: '1x2', selection: '1', priceMilli: price }, { fixtureId: fid, market: '1x2', selection: 'X', priceMilli: 3000 }] }))
      .rejects.toMatchObject({ code: 'same_match' });
    await expect(placeBet(db, uid, { stakeCents: 50, selections: [{ fixtureId: fid, market: '1x2', selection: '1', priceMilli: price }] })).rejects.toMatchObject({ code: 'stake_too_low' });
    await expect(placeBet(db, uid, { stakeCents: 900_000, selections: [{ fixtureId: fid, market: '1x2', selection: '1', priceMilli: price }] })).rejects.toMatchObject({ code: 'stake_too_high' });
    await expect(placeBet(db, uid, { stakeCents: 200_000, selections: [{ fixtureId: fid, market: '1x2', selection: '1', priceMilli: price }] })).rejects.toMatchObject({ code: 'insufficient_funds' });
    expect(await getBalance(db.q, uid)).toBe(100_000); // nothing was taken
  });
  it('a failed placement leaves no bet behind', async () => {
    const fid = `mock-${DATE}-1`;
    await expect(placeBet(db, uid, { stakeCents: 200_000, selections: [{ fixtureId: fid, market: '1x2', selection: '1', priceMilli: await priceOf(fid, '1') }] })).rejects.toBeTruthy();
    expect((await db.q('SELECT 1 FROM bets')).length).toBe(0);
  });
});

describe('settlement', () => {
  it('pays a winning accumulator once, loses a losing one, and is idempotent', async () => {
    const a = `mock-${DATE}-1`, b = `mock-${DATE}-2`;
    const pa = await priceOf(a, '1'), pb = await priceOf(b, '1');
    const acc = await placeBet(db, uid, { stakeCents: 10_000, selections: [{ fixtureId: a, market: '1x2', selection: '1', priceMilli: pa }, { fixtureId: b, market: '1x2', selection: '1', priceMilli: pb }] });
    const losing = await placeBet(db, uid, { stakeCents: 2_000, selections: [{ fixtureId: a, market: '1x2', selection: '2', priceMilli: await priceOf(a, '2') }] });
    expect(await getBalance(db.q, uid)).toBe(88_000);

    const r1 = await setResultAndSettle(db, a, { status: 'finished', homeScore: 2, awayScore: 0 });
    expect(r1.alreadySettled).toBe(false);
    let bets = await listBets(db, uid);
    expect(bets.find((x) => x.id === losing.id)!.status).toBe('lost');
    expect(bets.find((x) => x.id === acc.id)!.status).toBe('open'); // second leg still pending

    await setResultAndSettle(db, b, { status: 'finished', homeScore: 3, awayScore: 1 });
    bets = await listBets(db, uid);
    const won = bets.find((x) => x.id === acc.id)!;
    expect(won.status).toBe('won');
    expect(won.returnCents).toBe(acc.potentialReturnCents);
    expect(await getBalance(db.q, uid)).toBe(88_000 + acc.potentialReturnCents);

    const again = await setResultAndSettle(db, b, { status: 'finished', homeScore: 0, awayScore: 5 });
    expect(again.alreadySettled).toBe(true);
    expect(await getBalance(db.q, uid)).toBe(88_000 + acc.potentialReturnCents); // no double payout
  });
  it('refunds the stake when a single-leg match is cancelled', async () => {
    const a = `mock-${DATE}-3`;
    await placeBet(db, uid, { stakeCents: 4_000, selections: [{ fixtureId: a, market: '1x2', selection: 'X', priceMilli: await priceOf(a, 'X') }] });
    await setResultAndSettle(db, a, { status: 'cancelled' });
    expect(await getBalance(db.q, uid)).toBe(100_000);
    expect((await listBets(db, uid))[0].status).toBe('void');
  });
  it('ledger always reconciles with the wallet balance', async () => {
    const a = `mock-${DATE}-1`;
    await placeBet(db, uid, { stakeCents: 7_000, selections: [{ fixtureId: a, market: '1x2', selection: '1', priceMilli: await priceOf(a, '1') }] });
    await setResultAndSettle(db, a, { status: 'finished', homeScore: 1, awayScore: 0 });
    const sum = (await db.q<{ s: number }>('SELECT COALESCE(SUM(amount_cents),0)::int AS s FROM ledger WHERE user_id=$1', [uid]))[0].s;
    expect(sum).toBe(await getBalance(db.q, uid));
  });
});

describe('more markets end to end', () => {
  it('settles double chance, over/under and BTTS singles and an accumulator across markets', async () => {
    const a = `mock-${DATE}-1`, b = `mock-${DATE}-2`;
    const px = async (fid: string, market: string, sel: string) =>
      (await db.q<{ price_milli: number }>('SELECT price_milli FROM odds WHERE fixture_id=$1 AND market=$2 AND selection=$3', [fid, market, sel]))[0].price_milli;
    const dc = await placeBet(db, uid, { stakeCents: 1_000, selections: [{ fixtureId: a, market: 'dc', selection: '1X', priceMilli: await px(a, 'dc', '1X') }] });
    const over = await placeBet(db, uid, { stakeCents: 1_000, selections: [{ fixtureId: a, market: 'ou25', selection: 'O', priceMilli: await px(a, 'ou25', 'O') }] });
    const btts = await placeBet(db, uid, { stakeCents: 1_000, selections: [{ fixtureId: a, market: 'btts', selection: 'Y', priceMilli: await px(a, 'btts', 'Y') }] });
    const acc = await placeBet(db, uid, { stakeCents: 1_000, selections: [
      { fixtureId: a, market: 'ou25', selection: 'U', priceMilli: await px(a, 'ou25', 'U') },
      { fixtureId: b, market: 'btts', selection: 'N', priceMilli: await px(b, 'btts', 'N') },
    ] });
    await setResultAndSettle(db, a, { status: 'finished', homeScore: 1, awayScore: 1 }); // draw, 2 goals, both scored
    const bets = await listBets(db, uid);
    const st = (id: string) => bets.find((x) => x.id === id)!;
    expect(st(dc.id)).toMatchObject({ status: 'won', returnCents: dc.potentialReturnCents });
    expect(st(over.id).status).toBe('lost');
    expect(st(btts.id).status).toBe('won');
    expect(st(acc.id).status).toBe('open'); // U2.5 won, other leg pending
    expect(st(dc.id).legs[0]).toMatchObject({ market: 'dc', selection: '1X', label: 'Arsenal or draw' });
    await setResultAndSettle(db, b, { status: 'finished', homeScore: 2, awayScore: 0 });
    expect((await listBets(db, uid)).find((x) => x.id === acc.id)).toMatchObject({ status: 'won', returnCents: acc.potentialReturnCents });
    const sum = (await db.q<{ s: number }>('SELECT COALESCE(SUM(amount_cents),0)::int AS s FROM ledger WHERE user_id=$1', [uid]))[0].s;
    expect(sum).toBe(await getBalance(db.q, uid));
  });
});
