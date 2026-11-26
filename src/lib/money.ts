/** All money is stored as integer cents (N$ 1.00 = 100). Odds are stored as integer thousandths (1.95 = 1950). */
export const toCents = (n: number) => Math.round(n * 100);
export const formatNad = (cents: number) => `N$ ${(cents / 100).toFixed(2)}`;
export const formatOdds = (milli: number) => (milli / 1000).toFixed(2);
