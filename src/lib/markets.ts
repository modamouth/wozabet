import type { FixtureStatus, LegStatus } from './settle-logic';

/**
 * Football markets we offer. All settle on the 90-minute result (regular time incl. injury time;
 * extra time and penalties do NOT count). Selection keys are short and stable because they are stored on bets.
 */
export const MARKETS = {
  '1x2': { label: 'Match result', selections: ['1', 'X', '2'], overround: 1 },
  dc: { label: 'Double chance', selections: ['1X', '12', 'X2'], overround: 2 }, // each outcome is covered by two selections
  ou25: { label: 'Total goals over/under 2.5', selections: ['O', 'U'], overround: 1 },
  btts: { label: 'Both teams to score', selections: ['Y', 'N'], overround: 1 },
} as const;
export type MarketKey = keyof typeof MARKETS;
export const MARKET_KEYS = Object.keys(MARKETS) as MarketKey[];

export const isMarket = (m: string): m is MarketKey => m in MARKETS;
export const isSelection = (m: string, s: string) => isMarket(m) && (MARKETS[m].selections as readonly string[]).includes(s);

/** Human label for a pick, e.g. "Arsenal or draw", "Over 2.5 goals". */
export function selectionLabel(market: string, selection: string, home: string, away: string): string {
  const k = `${market}:${selection}`;
  const names: Record<string, string> = {
    '1x2:1': home, '1x2:X': 'Draw', '1x2:2': away,
    'dc:1X': `${home} or draw`, 'dc:12': `${home} or ${away}`, 'dc:X2': `Draw or ${away}`,
    'ou25:O': 'Over 2.5 goals', 'ou25:U': 'Under 2.5 goals',
    'btts:Y': 'Both teams to score: Yes', 'btts:N': 'Both teams to score: No',
  };
  return names[k] ?? `${market} ${selection}`;
}

export interface Result { status: FixtureStatus; homeScore: number | null; awayScore: number | null }

/** Outcome of one leg from the 90-minute score. */
export function legOutcome(market: string, selection: string, fx: Result): LegStatus {
  if (fx.status === 'cancelled') return 'void';
  if (fx.status !== 'finished' || fx.homeScore === null || fx.awayScore === null) return 'open';
  if (!isSelection(market, selection)) return 'void'; // unknown market/selection can never be graded: refund it
  const h = fx.homeScore, a = fx.awayScore;
  const res = h > a ? '1' : h < a ? '2' : 'X';
  let won: boolean;
  switch (market as MarketKey) {
    case '1x2': won = selection === res; break;
    case 'dc': won = selection.includes(res); break;
    case 'ou25': won = (h + a > 2.5) === (selection === 'O'); break;
    case 'btts': won = (h > 0 && a > 0) === (selection === 'Y'); break;
  }
  return won ? 'won' : 'lost';
}
