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
  const fin = (h: number, a: number, hasDraw = true) => ({ status: 'finished' as const, homeScore: h, awayScore: a, hasDraw });
  it('1X2 outcomes', () => {
    expect(legOutcome('1', fin(2, 1))).toBe('won');
    expect(legOutcome('X', fin(2, 1))).toBe('lost');
    expect(legOutcome('X', fin(1, 1))).toBe('won');
    expect(legOutcome('2', fin(0, 3))).toBe('won');
  });
  it('two-way market voids on a tie; cancelled voids; unfinished stays open', () => {
    expect(legOutcome('1', fin(20, 20, false))).toBe('void');
    expect(legOutcome('1', { status: 'cancelled', homeScore: null, awayScore: null, hasDraw: true })).toBe('void');
    expect(legOutcome('1', { status: 'live', homeScore: 1, awayScore: 0, hasDraw: true })).toBe('open');
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
