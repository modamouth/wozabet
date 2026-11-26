/** All money is stored as integer cents (N$ 1.00 = 100). Odds are stored as integer thousandths (1.95 = 1950). */
export const toCents = (n: number) => Math.round(n * 100);
export const formatNad = (cents: number) => `N$ ${(cents / 100).toFixed(2)}`;
export const formatOdds = (milli: number) => (milli / 1000).toFixed(2);

/** Parse what a user typed ("150", "150.5", "1 250,00") into integer cents without floating point. null if invalid. */
export function parseNadToCents(input: string): number | null {
  const s = input.trim().replace(/[\s ]/g, '').replace(/^N\$/i, '').replace(',', '.');
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}
