import { describe, it, expect } from 'vitest';
import { apiFootballProvider } from '@/lib/providers/apiFootball';
import { newBudget } from '@/lib/providers/types';

/**
 * Hits the REAL API (uses 2-3 requests of your daily quota). Skipped unless you opt in:
 *   API_FOOTBALL_LIVE_TEST=1 npx vitest run tests/api-football.live.test.ts   (with API_FOOTBALL_KEY in the environment)
 */
const live = process.env.API_FOOTBALL_LIVE_TEST === '1' && !!process.env.API_FOOTBALL_KEY;

describe.skipIf(!live)('API-Football live', () => {
  it('fetches today with the real response shape', async () => {
    const budget = newBudget(3);
    const list = await apiFootballProvider({ key: process.env.API_FOOTBALL_KEY!, leagues: [], bookmaker: '8', perFixtureMax: 1 })
      .fetchFixtures(new Date().toISOString().slice(0, 10), { budget });
    expect(list.length).toBeGreaterThan(0);
    for (const f of list.slice(0, 20)) {
      expect(f.id).toMatch(/^af-\d+$/);
      expect(f.kickoff.getTime()).not.toBeNaN();
      expect(['scheduled', 'live', 'finished', 'cancelled']).toContain(f.status);
    }
    expect(budget.dailyRemaining).not.toBeNull();
    console.log(`live: ${list.length} fixtures, ${list.filter((f) => f.markets).length} with odds, ${budget.used} requests, ${budget.dailyRemaining} left today`);
  });
});
