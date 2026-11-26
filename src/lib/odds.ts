export const MIN_PRICE_MILLI = 1010;

/**
 * Turn a reference bookmaker's decimal odds into OUR prices.
 * 1) strip the reference book's own margin (normalise implied probabilities to 100%, or 200% for double chance)
 * 2) apply our own margin (overround), rounding DOWN in the house's favour.
 */
export function applyMargin(source: Record<string, number>, margin: number, overround = 1): Record<string, number> {
  const entries = Object.entries(source).filter(([, o]) => Number.isFinite(o) && o > 1);
  if (entries.length < 2) return {};
  const sum = entries.reduce((a, [, o]) => a + 1 / o, 0);
  const out: Record<string, number> = {};
  for (const [sel, o] of entries) {
    // `overround` = what the fair probabilities add up to: 1 for normal markets, 2 for double chance
    const fair = (1 / o / sum) * overround;
    const price = 1 / (fair * (1 + margin));
    out[sel] = Math.max(MIN_PRICE_MILLI, Math.floor(price * 1000 + 1e-9));
  }
  return out;
}

/** Accumulator odds in thousandths, rounded down at every step. */
export function totalOddsMilli(pricesMilli: number[]): number {
  let t = 1000;
  for (const p of pricesMilli) t = Math.floor((t * p) / 1000);
  return t;
}

export const potentialReturnCents = (stakeCents: number, totalMilli: number) => Math.floor((stakeCents * totalMilli) / 1000);
