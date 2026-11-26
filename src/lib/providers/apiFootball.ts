import { config } from '../config';
import { leagueName } from '../leagues';
import type { FixtureStatus } from '../settle-logic';
import { newBudget, type Provider, type ProviderFixture, type RequestBudget } from './types';

/**
 * API-Football v3 adapter. Verified against the live API (free plan) on 2026-11-26:
 * - /fixtures?date=D works on the free plan; league+season filters for the current season are REFUSED on the free plan
 *   (HTTP 200 with errors.plan), so we always query by date and filter leagues ourselves.
 * - /odds?date=D is paged (10 fixtures per page; ~11 pages on a busy day); /odds?fixture=ID is one request per fixture.
 * - Limits come back in headers: x-ratelimit-requests-remaining (per day), x-ratelimit-remaining (per minute).
 */
const BASE = 'https://v3.football.api-sports.io';

export function mapStatus(short: string): FixtureStatus {
  if (['NS', 'TBD'].includes(short)) return 'scheduled';
  if (['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT', 'SUSP'].includes(short)) return 'live';
  if (['FT', 'AET', 'PEN'].includes(short)) return 'finished';
  if (['CANC', 'ABD', 'AWD', 'WO'].includes(short)) return 'cancelled';
  return 'scheduled'; // PST (postponed) etc: kickoff passes so betting closes; re-checked on the next sync
}

export function parseMatchWinner(values: { value: string; odd: string }[]): Record<string, number> | undefined {
  const map: Record<string, string> = { Home: '1', Draw: 'X', Away: '2' };
  const out: Record<string, number> = {};
  for (const v of values) if (map[v.value]) out[map[v.value]] = Number(v.odd);
  return Object.keys(out).length === 3 && Object.values(out).every((n) => Number.isFinite(n) && n > 1) ? out : undefined;
}

export class QuotaError extends Error {}

export interface ApiFootballOptions {
  key: string;
  leagues: string[];
  bookmaker: string;
  /** Stop making odds calls when fewer daily requests than this are left (keeps some for results). */
  minDailyRemaining?: number;
  /** Up to this many fixtures needing odds: one request each. Above it: page through /odds?date — but only when the
   *  remaining budget covers maxPages, because the pages aren't ordered by our leagues (a partial pass can price nothing). */
  perFixtureMax?: number;
  maxPages?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export function apiFootballProvider(opts: Partial<ApiFootballOptions> = {}): Provider {
  const o: ApiFootballOptions = {
    key: config.apiFootballKey, leagues: config.apiFootballLeagues, bookmaker: config.apiFootballBookmaker,
    minDailyRemaining: config.apiFootballMinDailyRemaining, perFixtureMax: 8, maxPages: 15, ...opts,
  };
  const doFetch = o.fetchImpl ?? fetch;
  const now = o.now ?? (() => new Date());

  async function get(path: string, budget: RequestBudget): Promise<any> {
    if (budget.stopped) throw new QuotaError(budget.stopped);
    if (budget.left <= 0) { budget.stopped = 'per-sync request budget used up'; throw new QuotaError(budget.stopped); }
    budget.left -= 1;
    budget.used += 1;
    const res = await doFetch(BASE + path, { headers: { 'x-apisports-key': o.key }, signal: AbortSignal.timeout(15_000) });
    const daily = res.headers.get('x-ratelimit-requests-remaining');
    if (daily !== null && daily !== '') budget.dailyRemaining = Number(daily);
    if (res.headers.get('x-ratelimit-remaining') === '0') budget.stopped = 'per-minute limit reached';
    if (res.status === 429) { budget.stopped = 'rate limited by API-Football (429)'; throw new QuotaError(budget.stopped); }
    if (!res.ok) throw new Error(`API-Football HTTP ${res.status} for ${path.split('?')[0]}`);
    const body = await res.json();
    if (body.errors && !Array.isArray(body.errors) && Object.keys(body.errors).length) {
      const msg = Object.values(body.errors).join('; ');
      if ('requests' in body.errors || 'rateLimit' in body.errors) { budget.stopped = msg; throw new QuotaError(msg); }
      throw new Error('API-Football: ' + msg);
    }
    if (budget.dailyRemaining !== null && budget.dailyRemaining <= (o.minDailyRemaining ?? 0)) budget.stopped ??= `daily quota low (${budget.dailyRemaining} left)`;
    return body;
  }

  function readOdds(r: any): { odds: Record<string, number>; updatedAt?: Date } | null {
    const bm = (r.bookmakers ?? []).find((b: any) => String(b.id) === String(o.bookmaker)) ?? r.bookmakers?.[0];
    const bet = bm?.bets?.find((b: any) => b.id === 1);
    const odds = bet && parseMatchWinner(bet.values);
    return odds ? { odds, updatedAt: r.update ? new Date(r.update) : undefined } : null;
  }

  return {
    name: 'api-football',
    async fetchFixtures(date, ctx) {
      const budget = ctx?.budget ?? newBudget(50);
      const leagues = new Set(o.leagues);
      const fx = await get(`/fixtures?date=${date}`, budget);
      const wanted: any[] = (fx.response ?? []).filter((r: any) => leagues.size === 0 || leagues.has(String(r.league.id)));

      // only pre-match fixtures need prices (live betting is off); soonest first so they win any budget squeeze
      const needOdds = wanted
        .filter((r) => mapStatus(r.fixture.status.short) === 'scheduled' && new Date(r.fixture.date) > now())
        .sort((a, b) => a.fixture.timestamp - b.fixture.timestamp);
      const odds = new Map<number, { odds: Record<string, number>; updatedAt?: Date }>();
      try {
        const page = needOdds.length > (o.perFixtureMax ?? 8) && budget.left >= (o.maxPages ?? 15);
        if (needOdds.length && !page) {
          // soonest first; whatever the budget doesn't reach is left for the next sync (and suspended if it goes stale)
          for (const r of needOdds) {
            const res = await get(`/odds?fixture=${r.fixture.id}&bookmaker=${o.bookmaker}`, budget);
            const parsed = res.response?.[0] && readOdds(res.response[0]);
            if (parsed) odds.set(r.fixture.id, parsed);
          }
        } else if (needOdds.length) {
          const ids = new Set(needOdds.map((r) => r.fixture.id));
          let pg = 1, total = 1;
          do {
            const res = await get(`/odds?date=${date}&bookmaker=${o.bookmaker}&page=${pg}`, budget);
            total = res.paging?.total ?? 1;
            for (const r of res.response ?? []) {
              if (!ids.has(r.fixture?.id)) continue;
              const parsed = readOdds(r);
              if (parsed) odds.set(r.fixture.id, parsed);
            }
            pg += 1;
          } while (pg <= total && odds.size < ids.size);
        }
      } catch (e) {
        if (!(e instanceof QuotaError)) throw e;
        // out of budget: return what we have; fixtures without fresh odds go stale and get suspended
      }

      return wanted.map((r: any): ProviderFixture => {
        const od = odds.get(r.fixture.id);
        return {
          id: `af-${r.fixture.id}`,
          sport: 'Football',
          league: leagueName(r.league.id, r.league.name, r.league.country),
          home: r.teams.home.name,
          away: r.teams.away.name,
          kickoff: new Date(r.fixture.date),
          status: mapStatus(r.fixture.status.short),
          homeScore: r.goals.home,
          awayScore: r.goals.away,
          odds: od?.odds,
          oddsUpdatedAt: od?.updatedAt,
        };
      });
    },
  };
}
