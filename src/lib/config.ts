const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : d;
};
const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : v === 'true');

export const config = {
  margin: num(process.env.MARGIN, 0.07),
  minStakeCents: num(process.env.MIN_STAKE_CENTS, 100),
  maxStakeCents: num(process.env.MAX_STAKE_CENTS, 500_000),
  maxPayoutCents: num(process.env.MAX_PAYOUT_CENTS, 5_000_000),
  maxLegs: num(process.env.MAX_LEGS, 10),
  liveBetting: bool(process.env.LIVE_BETTING, false),
  autoSettle: bool(process.env.AUTO_SETTLE, false),
  demoMode: bool(process.env.DEMO_MODE, false),
  apiFootballKey: process.env.API_FOOTBALL_KEY ?? '',
  apiFootballLeagues: (process.env.API_FOOTBALL_LEAGUES ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  apiFootballBookmaker: process.env.API_FOOTBALL_BOOKMAKER ?? '8',
  apiFootballMaxRequestsPerSync: num(process.env.API_FOOTBALL_MAX_REQUESTS_PER_SYNC, 9),
  apiFootballMinDailyRemaining: num(process.env.API_FOOTBALL_MIN_DAILY_REMAINING, 10),
  /** Suspend prices we haven't refreshed from the feed for this long. */
  oddsMaxAgeMinutes: num(process.env.ODDS_MAX_AGE_MINUTES, 30),
  /** Suspend prices the PROVIDER hasn't changed for this long (feed frozen upstream). 0 = off. */
  oddsMaxSourceAgeMinutes: num(process.env.ODDS_MAX_SOURCE_AGE_MINUTES, 360),
  /** Most the book may lose on one market (worst-case outcome), in cents. */
  maxMarketLiabilityCents: num(process.env.MAX_MARKET_LIABILITY_CENTS, 10_000_000),
  minDepositCents: num(process.env.MIN_DEPOSIT_CENTS, 1_000),
  maxDepositCents: num(process.env.MAX_DEPOSIT_CENTS, 500_000),
  minWithdrawalCents: num(process.env.MIN_WITHDRAWAL_CENTS, 5_000),
  maxWithdrawalCents: num(process.env.MAX_WITHDRAWAL_CENTS, 2_000_000),
};

export function authSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s && process.env.NODE_ENV === 'production') throw new Error('AUTH_SECRET must be set in production');
  return s || 'dev-only-secret-change-me-dev-only-secret';
}
