import type { FixtureStatus } from '../settle-logic';

export interface ProviderFixture {
  id: string; // globally unique, prefixed by provider, e.g. "af-12345"
  sport: 'Football' | 'Rugby' | 'Basketball';
  league: string;
  home: string;
  away: string;
  kickoff: Date;
  status: FixtureStatus;
  homeScore: number | null;
  awayScore: number | null;
  /** Reference decimal odds by selection: 1/X/2 (3-way) or 1/2 (2-way). Optional if the feed has none (yet). */
  odds?: Record<string, number>;
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
