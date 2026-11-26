import type { Db } from './db';

/** Counts for the admin dashboard: what needs a human today. Read-only. */
export async function adminSummary(db: Db) {
  const one = async (sql: string) => (await db.q<{ c: number }>(sql))[0].c;
  const [kycPending, withdrawalsPending, withdrawalsPendingCents, paymentsReview, toSettle, openBets, openStakesCents, players, fixturesUpcoming, pricedUpcoming] = await Promise.all([
    one("SELECT count(*)::int c FROM kyc_submissions WHERE status='submitted'"),
    one("SELECT count(*)::int c FROM withdrawals WHERE status='pending'"),
    one("SELECT COALESCE(SUM(amount_cents),0)::int c FROM withdrawals WHERE status='pending'"),
    one("SELECT count(*)::int c FROM payments WHERE status='review'"),
    one("SELECT count(*)::int c FROM fixtures WHERE settled=false AND (kickoff < now() OR status <> 'scheduled')"),
    one("SELECT count(*)::int c FROM bets WHERE status='open'"),
    one("SELECT COALESCE(SUM(stake_cents),0)::int c FROM bets WHERE status='open'"),
    one("SELECT count(*)::int c FROM users WHERE role='player'"),
    one("SELECT count(*)::int c FROM fixtures WHERE status='scheduled' AND kickoff > now()"),
    one("SELECT count(DISTINCT f.id)::int c FROM fixtures f JOIN odds o ON o.fixture_id=f.id WHERE f.status='scheduled' AND f.kickoff > now() AND NOT o.suspended"),
  ]);
  const lastSync = (await db.q<{ at: Date | null }>('SELECT max(updated_at) AS at FROM odds'))[0].at;
  return {
    kycPending, withdrawalsPending, withdrawalsPendingCents, paymentsReview, toSettle,
    openBets, openStakesCents, players, fixturesUpcoming, pricedUpcoming,
    lastOddsUpdate: lastSync ? new Date(lastSync).toISOString() : null,
  };
}
