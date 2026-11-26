import type { Provider, ProviderFixture } from './types';

type M = NonNullable<ProviderFixture['markets']>;
/** Reference prices for all four markets, derived from simple 1X2 + goal expectations. */
const mk = (h: number, d: number, a: number, over: number, bttsYes: number): M => ({
  '1x2': { '1': h, X: d, '2': a },
  dc: { '1X': 1 / (1 / h + 1 / d) * 1.05, '12': 1 / (1 / h + 1 / a) * 1.05, X2: 1 / (1 / d + 1 / a) * 1.05 },
  ou25: { O: over, U: 1 / (1.05 - 1 / over) },
  btts: { Y: bttsYes, N: 1 / (1.05 - 1 / bttsYes) },
});

/** Fake football data so the whole app runs without any API key. Fixtures are generated relative to "now". */
export function mockProvider(now = () => new Date()): Provider {
  return {
    name: 'mock',
    async fetchFixtures(date) {
      const base = now();
      const at = (hours: number) => new Date(base.getTime() + hours * 3_600_000);
      const f = (id: string, league: string, home: string, away: string, hours: number, markets: M, extra: Partial<ProviderFixture> = {}): ProviderFixture => ({
        id: `mock-${date}-${id}`, sport: 'Football', league, home, away, kickoff: at(hours),
        status: 'scheduled', homeScore: null, awayScore: null, markets, ...extra,
      });
      return [
        f('1', 'England Premier League', 'Arsenal', 'Chelsea', 5, mk(2.1, 3.5, 3.6, 1.85, 1.75)),
        f('2', 'England Premier League', 'Liverpool', 'Everton', 6, mk(1.55, 4.2, 6.0, 1.6, 1.9)),
        f('3', 'South Africa Premiership (PSL)', 'Orlando Pirates', 'Kaizer Chiefs', 24, mk(2.3, 3.1, 3.2, 2.3, 2.0)),
        f('4', 'Namibia Premier League', 'African Stars', 'Blue Waters', 48, mk(2.1, 3.2, 3.4, 2.2, 2.05)),
        f('5', 'Spain La Liga', 'Real Madrid', 'Sevilla', 50, mk(1.45, 4.8, 7.0, 1.55, 1.95)),
        f('9', 'South Africa Premiership (PSL)', 'Kaizer Chiefs', 'Brave Stars', -1, mk(1.5, 4.0, 6.5, 1.9, 2.1), { status: 'live', homeScore: 1, awayScore: 0 }),
      ];
    },
  };
}
