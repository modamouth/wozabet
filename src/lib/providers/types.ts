import type { FixtureStatus } from '../settle-logic';
import type { MarketKey } from '../markets';

export interface ProviderFixture {
  id: string; // globally unique, prefixed by provider, e.g. "af-12345"
  sport: 'Football';
  league: string;
  home: string;
  away: string;
  kickoff: Date;
  status: FixtureStatus;
  /** 90-minute score (extra time and penalties excluded) — what our markets settle on. */
  homeScore: number | null;
  awayScore: number | null;
  /** Reference decimal odds per market and selection, e.g. { '1x2': { '1': 2.1, X: 3.4, '2': 3.6 }, ou25: { O: 1.9, U: 1.9 } }. */
  markets?: Partial<Record<MarketKey, Record<string, number>>>;
  /** When the PROVIDER last changed these odds (not when we fetched them). */
  oddsUpdatedAt?: Date;
}

/** Caps API calls per sync so a paid quota (or the free plan's 10/min, 100/day) isn't blown. */
export interface RequestBudget { left: number; used: number; dailyRemaining: number | null; stopped: string | null }
export const newBudget = (max: number): RequestBudget => ({ left: max, used: 0, dailyRemaining: null, stopped: null });

export interface Provider {
  name: string;
  /** All fixtures for a calendar date (YYYY-MM-DD, UTC) incl. reference odds and current status/score. */
  fetchFixtures(date: string, ctx?: { budget?: RequestBudget }): Promise<ProviderFixture[]>;
}
