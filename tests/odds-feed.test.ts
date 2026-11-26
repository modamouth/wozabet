import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '@/lib/db';
import { config } from '@/lib/config';
import { apiFootballProvider, mapStatus, parseMatchWinner } from '@/lib/providers/apiFootball';
import { newBudget } from '@/lib/providers/types';
import { mockProvider } from '@/lib/providers/mock';
import { syncFixtures } from '@/lib/sync';
import { listMatches } from '@/lib/fixtures';
import { placeBet } from '@/lib/bets';
import { credit } from '@/lib/wallet';
import { suspendStaleOdds, selectionLiability } from '@/lib/risk';
import { listAudit } from '@/lib/audit';
import { leagueName } from '@/lib/leagues';
import { freshDb, makeUser } from './helpers';

/** Responses recorded from the live API-Football free plan on 2026-11-26 (trimmed). */
const REC = path.join(__dirname, 'fixtures/api-football');
const rec = (f: string) => JSON.parse(fs.readFileSync(path.join(REC, f), 'utf8'));
const NOW = new Date('2026-11-26T19:30:00Z');

function fakeApi(opts: { daily?: number; minute?: number; status?: number; body?: any } = {}) {
  const calls: string[] = [];
  let daily = opts.daily ?? 90;
  const fetchImpl = (async (url: string) => {
    const u = new URL(url);
    calls.push(u.pathname + u.search);
    daily -= 1;
    const headers = { 'x-ratelimit-requests-remaining': String(daily), 'x-ratelimit-remaining': String(opts.minute ?? 9) };
    if (opts.status) return new Response('{}', { status: opts.status, headers });
    if (opts.body) return new Response(JSON.stringify(opts.body), { headers });
    if (u.pathname === '/fixtures') return new Response(JSON.stringify(rec('fixtures-2026-11-26.json')), { headers });
    if (u.pathname === '/odds' && u.searchParams.get('fixture') === '1636252') return new Response(JSON.stringify(rec('odds-fixture-1636252.json')), { headers });
    if (u.pathname === '/odds' && u.searchParams.get('fixture')) return new Response(JSON.stringify({ errors: [], results: 0, paging: { current: 1, total: 1 }, response: [] }), { headers });
    if (u.pathname === '/odds' && u.searchParams.get('date')) return new Response(JSON.stringify(rec('odds-date-2026-11-26-p2.json')), { headers });
    return new Response('{}', { status: 404, headers });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('API-Football adapter (recorded live responses)', () => {
  it('maps fixtures, statuses, league names and attaches odds from a per-fixture call', async () => {
    const api = fakeApi();
    const p = apiFootballProvider({ key: 'k', leagues: ['3', '585', '584'], bookmaker: '8', fetchImpl: api.fetchImpl, now: () => NOW });
    const budget = newBudget(9);
    const list = await p.fetchFixtures('2026-11-26', { budget });
    expect(list.map((f) => f.league)).toContain('UEFA Europa League');
    expect(list.find((f) => f.id === 'af-1635338')!.league).toBe('Uganda Premier League'); // not confused with England/Namibia
    expect(list.find((f) => f.id === 'af-1649282')).toMatchObject({ status: 'scheduled' }); // PST
    expect(list.find((f) => f.id === 'af-1636231')).toMatchObject({ status: 'live', homeScore: expect.any(Number) });
    const palace = list.find((f) => f.id === 'af-1636252')!;
    expect(palace).toMatchObject({ home: 'Crystal Palace', away: 'Real Sociedad', status: 'scheduled' });
    expect(palace.odds).toEqual({ '1': expect.any(Number), X: expect.any(Number), '2': expect.any(Number) });
    expect(palace.oddsUpdatedAt?.toISOString()).toBe('2026-11-26T18:00:20.000Z');
    // only the not-started fixture needed odds: 1 fixtures call + 1 odds call
    expect(api.calls).toEqual(['/fixtures?date=2026-11-26', '/odds?fixture=1636252&bookmaker=8']);
    expect(budget).toMatchObject({ used: 2, dailyRemaining: 88 });
  });

  it('pages through /odds?date only when the budget covers the pages, and stops at the budget', async () => {
    const api = fakeApi();
    const p = apiFootballProvider({ key: 'k', leagues: [], bookmaker: '8', perFixtureMax: 0, maxPages: 3, fetchImpl: api.fetchImpl, now: () => NOW });
    const budget = newBudget(4);
    const list = await p.fetchFixtures('2026-11-26', { budget });
    expect(list.length).toBeGreaterThan(5); // fixtures still come back without odds
    expect(api.calls.filter((c) => c.startsWith('/odds?date')).length).toBe(3);
    expect(budget.stopped).toMatch(/budget/);
  });

  it('with a small budget it prices the soonest fixtures one by one instead of gambling on pages', async () => {
    const api = fakeApi();
    const p = apiFootballProvider({ key: 'k', leagues: [], bookmaker: '8', perFixtureMax: 0, maxPages: 15, fetchImpl: api.fetchImpl, now: () => NOW });
    const list = await p.fetchFixtures('2026-11-26', { budget: newBudget(4) });
    expect(api.calls.some((c) => c.startsWith('/odds?date'))).toBe(false);
    expect(api.calls.filter((c) => c.startsWith('/odds?fixture')).length).toBe(1); // only one recorded fixture is still to start
    expect(list.find((f) => f.id === 'af-1636252')!.odds).toBeDefined();
  });

  it('stops when the daily quota is low or the per-minute limit is hit', async () => {
    const low = fakeApi({ daily: 6 });
    const b1 = newBudget(20);
    await apiFootballProvider({ key: 'k', leagues: [], bookmaker: '8', perFixtureMax: 0, maxPages: 1, minDailyRemaining: 5, fetchImpl: low.fetchImpl, now: () => NOW }).fetchFixtures('2026-11-26', { budget: b1 });
    expect(b1.stopped).toMatch(/daily quota low/);
    expect(low.calls.length).toBe(1);
    const minute = fakeApi({ minute: 0 });
    const b2 = newBudget(20);
    await apiFootballProvider({ key: 'k', leagues: [], bookmaker: '8', perFixtureMax: 0, maxPages: 1, fetchImpl: minute.fetchImpl, now: () => NOW }).fetchFixtures('2026-11-26', { budget: b2 });
    expect(b2.stopped).toMatch(/per-minute/);
  });

  it('surfaces plan errors returned with HTTP 200, and 429s', async () => {
    const planErr = { errors: { plan: 'Free plans do not have access to this season, try from 2022 to 2024.' }, results: 0, response: [] };
    await expect(apiFootballProvider({ key: 'k', leagues: [], bookmaker: '8', fetchImpl: fakeApi({ body: planErr }).fetchImpl }).fetchFixtures('2026-11-26'))
      .rejects.toThrow(/Free plans do not have access/);
    await expect(apiFootballProvider({ key: 'k', leagues: [], bookmaker: '8', fetchImpl: fakeApi({ status: 429 }).fetchImpl }).fetchFixtures('2026-11-26'))
      .rejects.toThrow(/429/);
  });

  it('parses only complete, valid 1X2 prices; maps edge statuses', () => {
    expect(parseMatchWinner([{ value: 'Home', odd: '1.38' }, { value: 'Draw', odd: '4.33' }, { value: 'Away', odd: '10.00' }])).toEqual({ '1': 1.38, X: 4.33, '2': 10 });
    expect(parseMatchWinner([{ value: 'Home', odd: '1.38' }, { value: 'Away', odd: '10.00' }])).toBeUndefined();
    expect(parseMatchWinner([{ value: 'Home', odd: '1.00' }, { value: 'Draw', odd: '4' }, { value: 'Away', odd: '9' }])).toBeUndefined();
    expect(mapStatus('SUSP')).toBe('live');
    expect(mapStatus('AWD')).toBe('cancelled');
    expect(leagueName(409, 'Premier League', 'Namibia')).toBe('Namibia Premier League');
    expect(leagueName(999, 'Premier League', 'Libya')).toBe('Libya Premier League');
  });

  it('syncs recorded data end to end with our margin and the provider timestamp', async () => {
    const db = await freshDb();
    const p = apiFootballProvider({ key: 'k', leagues: ['3'], bookmaker: '8', fetchImpl: fakeApi().fetchImpl, now: () => NOW });
    const r = await syncFixtures(db, [p], ['2026-11-26']);
    expect(r).toMatchObject({ withOdds: 1, errors: [] });
    const o = await db.q<any>("SELECT selection, source_milli, price_milli, source_updated_at FROM odds WHERE fixture_id='af-1636252' ORDER BY selection");
    expect(o).toHaveLength(3);
    for (const row of o) expect(row.price_milli).toBeLessThan(row.source_milli); // margin applied
  });
});

describe('odds staleness protection', () => {
  const DATE = '2026-11-26';
  let db: Db;
  let uid: string;
  const saved = { ...config };
  beforeEach(async () => {
    db = await freshDb();
    await syncFixtures(db, [mockProvider()], [DATE]);
    uid = (await makeUser(db)).id;
    await credit(db.q, uid, 100_000, 'deposit', 'd');
  });
  afterEach(() => Object.assign(config, saved));
  const price = async (fid: string) => (await db.q<{ price_milli: number }>("SELECT price_milli FROM odds WHERE fixture_id=$1 AND selection='1'", [fid]))[0].price_milli;

  it('odds not refreshed for N minutes are suspended in listings and refused at bet time', async () => {
    const fid = `mock-${DATE}-1`;
    const p = await price(fid);
    await db.q("UPDATE odds SET updated_at = now() - interval '31 minutes' WHERE fixture_id=$1", [fid]);
    const m = (await listMatches(db, { sport: 'Football' })).find((x) => x.id === fid)!;
    expect(m.odds.every((o) => o.suspended)).toBe(true);
    await expect(placeBet(db, uid, { stakeCents: 1_000, selections: [{ fixtureId: fid, selection: '1', priceMilli: p }] })).rejects.toMatchObject({ code: 'unavailable' });

    expect(await suspendStaleOdds(db)).toBe(1);
    expect((await listAudit(db.q, { action: 'odds.suspended_stale' }))[0].details).toMatchObject({ fixtures: [fid] });
    // the next successful sync brings fresh prices and lifts the suspension
    await syncFixtures(db, [mockProvider()], [DATE]);
    expect((await placeBet(db, uid, { stakeCents: 1_000, selections: [{ fixtureId: fid, selection: '1', priceMilli: await price(fid) }] })).stakeCents).toBe(1_000);
  });

  it('a feed frozen upstream (old provider timestamp) also counts as stale; N is configurable', async () => {
    const fid = `mock-${DATE}-2`;
    await db.q("UPDATE odds SET source_updated_at = now() - interval '7 hours' WHERE fixture_id=$1", [fid]);
    expect((await listMatches(db, { sport: 'Football' })).find((x) => x.id === fid)!.odds.every((o) => o.suspended)).toBe(true);
    config.oddsMaxSourceAgeMinutes = 0; // check off
    expect((await listMatches(db, { sport: 'Football' })).find((x) => x.id === fid)!.odds.some((o) => o.suspended)).toBe(false);
    config.oddsMaxAgeMinutes = 5;
    await db.q("UPDATE odds SET updated_at = now() - interval '6 minutes' WHERE fixture_id=$1", [fid]);
    expect((await listMatches(db, { sport: 'Football' })).find((x) => x.id === fid)!.odds.every((o) => o.suspended)).toBe(true);
  });
});

describe('market exposure limit', () => {
  const DATE = '2026-11-26';
  let db: Db;
  const saved = { ...config };
  beforeEach(async () => { db = await freshDb(); await syncFixtures(db, [mockProvider()], [DATE]); });
  afterEach(() => Object.assign(config, saved));
  const price = async (fid: string, sel: string) => (await db.q<{ price_milli: number }>('SELECT price_milli FROM odds WHERE fixture_id=$1 AND selection=$2', [fid, sel]))[0].price_milli;
  const player = async () => { const u = await makeUser(db); await credit(db.q, u.id, 1_000_000, 'deposit', `d-${u.id}`); return u.id; };

  it('refuses bets that push the worst-case loss on a market past the limit, across players', async () => {
    config.maxMarketLiabilityCents = 50_000; // N$500
    const fid = `mock-${DATE}-1`;
    const p1 = await price(fid, '1'); // ~1.9x
    const a = await player(), b = await player();
    // each N$200 single on "1" adds ~N$180 net liability
    await placeBet(db, a, { stakeCents: 20_000, selections: [{ fixtureId: fid, selection: '1', priceMilli: p1 }] });
    await placeBet(db, b, { stakeCents: 20_000, selections: [{ fixtureId: fid, selection: '1', priceMilli: p1 }] });
    const before = await selectionLiability(db.q, fid, '1');
    await expect(placeBet(db, a, { stakeCents: 40_000, selections: [{ fixtureId: fid, selection: '1', priceMilli: p1 }] }))
      .rejects.toMatchObject({ code: 'market_limit', data: { fixtureId: fid, selection: '1' } });
    expect(await selectionLiability(db.q, fid, '1')).toEqual(before); // nothing booked
    // money on the other outcomes offsets the liability on "1"
    await placeBet(db, b, { stakeCents: 20_000, selections: [{ fixtureId: fid, selection: '2', priceMilli: await price(fid, '2') }] });
    const after = await selectionLiability(db.q, fid, '1');
    expect(after.netCents).toBe(before.netCents - 20_000);
    // …which now leaves room on "1" for the bet that was refused a moment ago? No: 40k more is still too much, 10k fits
    await expect(placeBet(db, a, { stakeCents: 40_000, selections: [{ fixtureId: fid, selection: '1', priceMilli: p1 }] })).rejects.toMatchObject({ code: 'market_limit' });
    expect((await placeBet(db, a, { stakeCents: 10_000, selections: [{ fixtureId: fid, selection: '1', priceMilli: p1 }] })).stakeCents).toBe(10_000);
  });

  it('counts accumulator legs at full potential return on every market they touch', async () => {
    config.maxMarketLiabilityCents = 30_000;
    const a = await player();
    const f1 = `mock-${DATE}-1`, f2 = `mock-${DATE}-2`;
    const legs = [{ fixtureId: f1, selection: '1', priceMilli: await price(f1, '1') }, { fixtureId: f2, selection: '1', priceMilli: await price(f2, '1') }];
    await expect(placeBet(db, a, { stakeCents: 10_000, selections: legs })).rejects.toMatchObject({ code: 'market_limit' }); // ~N$290 return + already-held 0
    const ok = await placeBet(db, a, { stakeCents: 5_000, selections: legs });
    expect((await selectionLiability(db.q, f2, '1')).payoutCents).toBe(ok.potentialReturnCents);
  });
});
