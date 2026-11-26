export type LegStatus = 'open' | 'won' | 'lost' | 'void';
export type FixtureStatus = 'scheduled' | 'live' | 'finished' | 'cancelled';

export { legOutcome } from './markets';

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
