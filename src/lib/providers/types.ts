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
  /** Reference decimal odds by selection: 1/X/2 (3-way) or 1/2 (2-way). Optional if the feed has none yet. */
  odds?: Record<string, number>;
}

export interface Provider {
  name: string;
  /** All fixtures for a calendar date (YYYY-MM-DD, UTC) incl. reference odds and current status/score. */
  fetchFixtures(date: string): Promise<ProviderFixture[]>;
}
