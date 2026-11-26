import type { Provider, ProviderFixture } from './types';

/** Fake data so the whole app runs without any API key. Fixtures are generated relative to "now". */
export function mockProvider(now = () => new Date()): Provider {
  return {
    name: 'mock',
    async fetchFixtures(date) {
      const base = now();
      const at = (hours: number) => new Date(base.getTime() + hours * 3_600_000);
      const f = (
        id: string, sport: ProviderFixture['sport'], league: string, home: string, away: string,
        hours: number, odds: Record<string, number>, extra: Partial<ProviderFixture> = {},
      ): ProviderFixture => ({
        id: `mock-${date}-${id}`, sport, league, home, away, kickoff: at(hours),
        status: 'scheduled', homeScore: null, awayScore: null, odds, ...extra,
      });
      return [
        f('1', 'Football', 'Premier League', 'Arsenal', 'Chelsea', 5, { '1': 2.1, X: 3.5, '2': 3.6 }),
        f('2', 'Football', 'Premier League', 'Liverpool', 'Everton', 6, { '1': 1.55, X: 4.2, '2': 6.0 }),
        f('3', 'Football', 'PSL', 'Orlando Pirates', 'Kaizer Chiefs', 24, { '1': 2.3, X: 3.1, '2': 3.2 }),
        f('4', 'Football', 'Namibia Premier League', 'African Stars', 'Blue Waters', 48, { '1': 2.1, X: 3.2, '2': 3.4 }),
        f('5', 'Football', 'La Liga', 'Real Madrid', 'Sevilla', 50, { '1': 1.45, X: 4.8, '2': 7.0 }),
        f('6', 'Rugby', 'International', 'Namibia', 'Zimbabwe', 52, { '1': 1.5, '2': 2.6 }),
        f('7', 'Rugby', 'International', 'South Africa', 'New Zealand', 72, { '1': 1.95, '2': 1.9 }),
        f('8', 'Basketball', 'NBA', 'Lakers', 'Celtics', 9, { '1': 2.3, '2': 1.65 }),
        f('9', 'Football', 'PSL', 'Kaizer Chiefs', 'Brave Stars', -1, { '1': 1.5, X: 4.0, '2': 6.5 }, { status: 'live', homeScore: 1, awayScore: 0 }),
      ];
    },
  };
}
