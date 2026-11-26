/**
 * API-Football league ids we know, with the names we show. API names are ambiguous
 * ("Premier League" is England, Namibia, Uganda, Libya…), so we always display country + competition.
 * Checked against the live API on 2026-11-26.
 */
export interface LeagueInfo { id: number; name: string; priority: number; oddsAvailable: boolean; note?: string }

export const LEAGUES: Record<number, LeagueInfo> = {
  39: { id: 39, name: 'England Premier League', priority: 1, oddsAvailable: true },
  2: { id: 2, name: 'UEFA Champions League', priority: 2, oddsAvailable: true },
  3: { id: 3, name: 'UEFA Europa League', priority: 3, oddsAvailable: true },
  848: { id: 848, name: 'UEFA Conference League', priority: 4, oddsAvailable: true },
  140: { id: 140, name: 'Spain La Liga', priority: 5, oddsAvailable: true },
  135: { id: 135, name: 'Italy Serie A', priority: 6, oddsAvailable: true },
  78: { id: 78, name: 'Germany Bundesliga', priority: 7, oddsAvailable: true },
  61: { id: 61, name: 'France Ligue 1', priority: 8, oddsAvailable: true },
  288: { id: 288, name: 'South Africa Premiership (PSL)', priority: 9, oddsAvailable: true },
  400: { id: 400, name: 'Zambia Super League', priority: 20, oddsAvailable: true },
  409: {
    id: 409, name: 'Namibia Premier League', priority: 0, oddsAvailable: false,
    note: 'Listed by API-Football, but its latest season is 2018 with no odds coverage. Needs another data source.',
  },
};

export function leagueName(id: number, apiName: string, apiCountry?: string): string {
  return LEAGUES[id]?.name ?? (apiCountry && apiCountry !== 'World' ? `${apiCountry} ${apiName}` : apiName);
}
