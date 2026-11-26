import { describe, it, expect } from 'vitest';
import { applyMargin, totalOddsMilli, potentialReturnCents } from '@/lib/odds';
import { legOutcome, resolveBet } from '@/lib/settle-logic';
import { ageOn, normalizePhone } from '@/lib/users';
import { mapStatus, parseMatchWinner } from '@/lib/providers/apiFootball';

describe('odds', () => {
  it('applies our margin after stripping the reference margin', () => {
    const p = applyMargin({ '1': 2.0, X: 3.5, '2': 4.0 }, 0.07);
    const overround = Object.values(p).reduce((a, m) => a + 1000 / m, 0);
    expect(overround).toBeGreaterThanOrEqual(1.07 - 0.005);
    expect(overround).toBeLessThan(1.09);
    // rounding is always down (house favour)
    for (const m of Object.values(p)) expect(Number.isInteger(m)).toBe(true);
  });
  it('never goes below the minimum price and needs 2+ outcomes', () => {
    expect(applyMargin({ '1': 1.001, '2': 20 }, 0.07)['1']).toBe(1010);
    expect(applyMargin({ '1': 2 }, 0.07)).toEqual({});
    expect(applyMargin({ '1': 0.5, '2': 2 }, 0.07)).toEqual({});
  });
  it('multiplies accumulators with integer maths', () => {
    expect(totalOddsMilli([2000, 1500])).toBe(3000);
    expect(totalOddsMilli([1950])).toBe(1950);
    expect(potentialReturnCents(5000, 3000)).toBe(15000);
    expect(potentialReturnCents(333, 1950)).toBe(649); // floors
  });
});

describe('settlement logic', () => {
  const fin = (h: number, a: number) => ({ status: 'finished' as const, homeScore: h, awayScore: a });
  it('1X2 outcomes', () => {
    expect(legOutcome('1x2', '1', fin(2, 1))).toBe('won');
    expect(legOutcome('1x2', 'X', fin(2, 1))).toBe('lost');
    expect(legOutcome('1x2', 'X', fin(1, 1))).toBe('won');
    expect(legOutcome('1x2', '2', fin(0, 3))).toBe('won');
  });
  it('cancelled voids; unfinished stays open; unknown selections are voided, never guessed', () => {
    expect(legOutcome('1x2', '1', { status: 'cancelled', homeScore: null, awayScore: null })).toBe('void');
    expect(legOutcome('ou25', 'O', { status: 'live', homeScore: 3, awayScore: 0 })).toBe('open');
    expect(legOutcome('1x2', 'Z', fin(1, 0))).toBe('void');
    expect(legOutcome('handicap', '1', fin(1, 0))).toBe('void');
  });
  it('resolves bets', () => {
    expect(resolveBet(1000, [{ status: 'won', priceMilli: 2000 }, { status: 'lost', priceMilli: 1500 }]).status).toBe('lost');
    expect(resolveBet(1000, [{ status: 'lost', priceMilli: 2000 }, { status: 'open', priceMilli: 1500 }]).status).toBe('lost');
    expect(resolveBet(1000, [{ status: 'won', priceMilli: 2000 }, { status: 'open', priceMilli: 1500 }]).status).toBe('open');
    expect(resolveBet(1000, [{ status: 'won', priceMilli: 2000 }, { status: 'won', priceMilli: 1500 }])).toEqual({ status: 'won', returnCents: 3000 });
    expect(resolveBet(1000, [{ status: 'won', priceMilli: 2000 }, { status: 'void', priceMilli: 1500 }])).toEqual({ status: 'won', returnCents: 2000 });
    expect(resolveBet(1000, [{ status: 'void', priceMilli: 2000 }])).toEqual({ status: 'void', returnCents: 1000 });
  });
});

describe('users + provider helpers', () => {
  it('normalises Namibian numbers', () => {
    expect(normalizePhone('081 234 5678')).toBe('+264812345678');
    expect(normalizePhone('+264 81 234 5678')).toBe('+264812345678');
    expect(() => normalizePhone('123')).toThrow();
  });
  it('computes age', () => {
    const today = new Date('2026-11-26T00:00:00Z');
    expect(ageOn('2008-11-26', today)).toBe(18);
    expect(ageOn('2008-11-27', today)).toBe(17);
  });
  it('maps API-Football statuses and match-winner odds', () => {
    expect(mapStatus('NS')).toBe('scheduled');
    expect(mapStatus('2H')).toBe('live');
    expect(mapStatus('FT')).toBe('finished');
    expect(mapStatus('CANC')).toBe('cancelled');
    expect(parseMatchWinner([{ value: 'Home', odd: '1.9' }, { value: 'Draw', odd: '3.4' }, { value: 'Away', odd: '4.2' }])).toEqual({ '1': 1.9, X: 3.4, '2': 4.2 });
    expect(parseMatchWinner([{ value: 'Home', odd: '1.9' }])).toBeUndefined();
  });
});

describe('more markets (90-minute result)', () => {
  const fin = (h: number, a: number) => ({ status: 'finished' as const, homeScore: h, awayScore: a });
  it('double chance', () => {
    expect(legOutcome('dc', '1X', fin(1, 0))).toBe('won');
    expect(legOutcome('dc', '1X', fin(1, 1))).toBe('won');
    expect(legOutcome('dc', '1X', fin(0, 1))).toBe('lost');
    expect(legOutcome('dc', '12', fin(2, 2))).toBe('lost');
    expect(legOutcome('dc', '12', fin(0, 2))).toBe('won');
    expect(legOutcome('dc', 'X2', fin(3, 2))).toBe('lost');
  });
  it('over/under 2.5', () => {
    expect(legOutcome('ou25', 'O', fin(2, 1))).toBe('won');
    expect(legOutcome('ou25', 'U', fin(2, 1))).toBe('lost');
    expect(legOutcome('ou25', 'U', fin(1, 1))).toBe('won');
    expect(legOutcome('ou25', 'O', fin(0, 0))).toBe('lost');
    expect(legOutcome('ou25', 'O', fin(5, 0))).toBe('won');
  });
  it('both teams to score', () => {
    expect(legOutcome('btts', 'Y', fin(1, 1))).toBe('won');
    expect(legOutcome('btts', 'Y', fin(3, 0))).toBe('lost');
    expect(legOutcome('btts', 'N', fin(3, 0))).toBe('won');
    expect(legOutcome('btts', 'N', fin(0, 0))).toBe('won');
  });
  it('double-chance margin normalises to 200%', () => {
    const p = applyMargin({ '1X': 1.07, '12': 1.18, X2: 3.0 }, 0.07, 2);
    const implied = Object.values(p).reduce((a, m) => a + 1000 / m, 0);
    expect(implied).toBeGreaterThanOrEqual(2 * 1.07 - 1e-9);
    expect(implied).toBeLessThan(2 * 1.07 + 0.02);
  });
});

describe('API-Football markets + regular-time score', () => {
  it('parses the four markets from a recorded bookmaker payload and ignores incomplete ones', async () => {
    const { parseMarkets, regularTimeScore } = await import('@/lib/providers/apiFootball');
    const rec = (await import('./fixtures/api-football/odds-fixture-1636252.json')).default as any;
    const m = parseMarkets(rec.response[0].bookmakers[0].bets);
    expect(Object.keys(m).sort()).toEqual(['1x2', 'btts', 'dc', 'ou25']);
    expect(parseMarkets([{ id: 5, values: [{ value: 'Over 2.5', odd: '1.9' }] }])).toEqual({});
    // recorded PEN match: settle on 90 minutes, not on the shoot-out
    expect(regularTimeScore({ fixture: { status: { short: 'PEN' } }, goals: { home: 3, away: 3 }, score: { fulltime: { home: 3, away: 3 } } })).toEqual({ home: 3, away: 3 });
    expect(regularTimeScore({ fixture: { status: { short: 'AET' } }, goals: { home: 2, away: 1 }, score: { fulltime: { home: 1, away: 1 } } })).toEqual({ home: 1, away: 1 });
    expect(regularTimeScore({ fixture: { status: { short: 'FT' } }, goals: { home: 2, away: 0 }, score: { fulltime: { home: 2, away: 0 } } })).toEqual({ home: 2, away: 0 });
  });
});
