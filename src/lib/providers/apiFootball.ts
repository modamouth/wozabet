import { config } from '../config';
import type { FixtureStatus } from '../settle-logic';
import type { Provider, ProviderFixture } from './types';

const BASE = 'https://v3.football.api-sports.io';

/** API-Football short status codes -> our status */
export function mapStatus(short: string): FixtureStatus {
  if (['NS', 'TBD'].includes(short)) return 'scheduled';
  if (['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT'].includes(short)) return 'live';
  if (['FT', 'AET', 'PEN'].includes(short)) return 'finished';
  if (['CANC', 'ABD', 'AWD', 'WO'].includes(short)) return 'cancelled';
  return 'scheduled'; // PST (postponed), SUSP etc: leave open and re-check on the next sync
}

async function get(path: string, key: string): Promise<any> {
  const res = await fetch(BASE + path, { headers: { 'x-apisports-key': key }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`API-Football ${res.status} for ${path}`);
  const body = await res.json();
  if (body.errors && Object.keys(body.errors).length && !Array.isArray(body.errors)) {
    throw new Error('API-Football error: ' + JSON.stringify(body.errors));
  }
  return body;
}

export function parseMatchWinner(values: { value: string; odd: string }[]): Record<string, number> | undefined {
  const map: Record<string, string> = { Home: '1', Draw: 'X', Away: '2' };
  const out: Record<string, number> = {};
  for (const v of values) if (map[v.value]) out[map[v.value]] = Number(v.odd);
  return Object.keys(out).length === 3 ? out : undefined;
}

export function apiFootballProvider(key = config.apiFootballKey): Provider {
  return {
    name: 'api-football',
    async fetchFixtures(date) {
      const leagues = new Set(config.apiFootballLeagues);
      const fx = await get(`/fixtures?date=${date}`, key);
      const wanted: any[] = (fx.response ?? []).filter((r: any) => leagues.size === 0 || leagues.has(String(r.league.id)));
      const oddsById = new Map<number, Record<string, number>>();
      if (wanted.length) {
        let page = 1;
        let total = 1;
        do {
          const o = await get(`/odds?date=${date}&bet=1&bookmaker=${config.apiFootballBookmaker}&page=${page}`, key);
          total = o.paging?.total ?? 1;
          for (const r of o.response ?? []) {
            const bet = r.bookmakers?.[0]?.bets?.find((b: any) => b.id === 1);
            const parsed = bet && parseMatchWinner(bet.values);
            if (parsed) oddsById.set(r.fixture.id, parsed);
          }
          page += 1;
        } while (page <= total);
      }
      return wanted.map((r: any): ProviderFixture => ({
        id: `af-${r.fixture.id}`,
        sport: 'Football',
        league: r.league.name,
        home: r.teams.home.name,
        away: r.teams.away.name,
        kickoff: new Date(r.fixture.date),
        status: mapStatus(r.fixture.status.short),
        homeScore: r.goals.home,
        awayScore: r.goals.away,
        odds: oddsById.get(r.fixture.id),
      }));
    },
  };
}
