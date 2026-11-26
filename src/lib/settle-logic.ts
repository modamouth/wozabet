export type LegStatus = 'open' | 'won' | 'lost' | 'void';
export type FixtureStatus = 'scheduled' | 'live' | 'finished' | 'cancelled';

export interface FixtureResult {
  status: FixtureStatus;
  homeScore: number | null;
  awayScore: number | null;
  /** true for 3-way markets (1/X/2); false for 2-way (1/2) where a tie voids the leg */
  hasDraw: boolean;
}

export function legOutcome(selection: string, fx: FixtureResult): LegStatus {
  if (fx.status === 'cancelled') return 'void';
  if (fx.status !== 'finished' || fx.homeScore === null || fx.awayScore === null) return 'open';
  const res = fx.homeScore > fx.awayScore ? '1' : fx.homeScore < fx.awayScore ? '2' : 'X';
  if (res === 'X' && !fx.hasDraw) return 'void';
  return selection === res ? 'won' : 'lost';
}

export interface BetResolution {
  status: 'open' | 'won' | 'lost' | 'void';
  returnCents: number;
}

/** Decide a bet from its legs. A lost leg loses the whole bet immediately; void legs drop out of the accumulator. */
export function resolveBet(stakeCents: number, legs: { status: LegStatus; priceMilli: number }[]): BetResolution {
  if (legs.some((l) => l.status === 'lost')) return { status: 'lost', returnCents: 0 };
  if (legs.some((l) => l.status === 'open')) return { status: 'open', returnCents: 0 };
  const won = legs.filter((l) => l.status === 'won');
  if (won.length === 0) return { status: 'void', returnCents: stakeCents };
  let t = 1000;
  for (const l of won) t = Math.floor((t * l.priceMilli) / 1000);
  return { status: 'won', returnCents: Math.floor((stakeCents * t) / 1000) };
}
