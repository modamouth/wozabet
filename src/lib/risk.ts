import type { Db, Q } from './db';
import { AppError } from './errors';
import { config } from './config';
import { formatNad } from './money';
import { audit } from './audit';

/**
 * SQL condition: these odds are too old to trade on. Either WE haven't refreshed them from the feed for
 * ODDS_MAX_AGE_MINUTES (feed down / sync not running), or the PROVIDER hasn't changed them for
 * ODDS_MAX_SOURCE_AGE_MINUTES (feed frozen upstream). Applied at listing AND at bet time, so stale prices are
 * never bettable even if the suspend job hasn't run.
 */
export function staleSql(alias = 'o'): string {
  const fetchAge = Math.max(1, Math.floor(config.oddsMaxAgeMinutes));
  const srcAge = Math.max(0, Math.floor(config.oddsMaxSourceAgeMinutes));
  const src = srcAge > 0 ? ` OR COALESCE(${alias}.source_updated_at, ${alias}.updated_at) < now() - make_interval(mins => ${srcAge})` : '';
  return `(${alias}.updated_at < now() - make_interval(mins => ${fetchAge})${src})`;
}

/** Persist the suspension (so admins see it and it survives config changes). Fresh odds from the next sync lift it. */
export async function suspendStaleOdds(db: Db): Promise<number> {
  const rows = await db.q<{ fixture_id: string }>(`UPDATE odds o SET suspended = true WHERE NOT o.suspended AND ${staleSql('o')} RETURNING fixture_id`);
  const fixtures = [...new Set(rows.map((r) => r.fixture_id))];
  if (fixtures.length) await audit(db.q, { actorId: null, action: 'odds.suspended_stale', details: { fixtures: fixtures.slice(0, 50), count: fixtures.length } });
  return fixtures.length;
}

/**
 * Worst-case loss on one market if `selection` wins: what we'd pay out on bets containing that selection, minus the
 * single-bet stakes we hold on the market. Accumulator legs count their FULL potential return (conservative) and their
 * stakes are not netted off.
 */
export async function selectionLiability(q: Q, fixtureId: string, selection: string): Promise<{ payoutCents: number; heldStakesCents: number; netCents: number }> {
  const r = await q<{ payout: number; held: number }>(
    `SELECT
       COALESCE((SELECT SUM(b.potential_return_cents) FROM bet_legs l JOIN bets b ON b.id = l.bet_id
                  WHERE l.fixture_id = $1 AND l.selection = $2 AND l.status = 'open' AND b.status = 'open'), 0)::bigint AS payout,
       COALESCE((SELECT SUM(b.stake_cents) FROM bet_legs l JOIN bets b ON b.id = l.bet_id
                  WHERE l.fixture_id = $1 AND b.kind = 'single' AND b.status = 'open'), 0)::bigint AS held`,
    [fixtureId, selection]);
  const payoutCents = Number(r[0].payout), heldStakesCents = Number(r[0].held);
  return { payoutCents, heldStakesCents, netCents: payoutCents - heldStakesCents };
}

/** Refuse a bet that would push any of its markets past MAX_MARKET_LIABILITY_CENTS. Call with the fixtures locked. */
export async function assertWithinLiability(q: Q, bet: { legs: { fixtureId: string; selection: string }[]; stakeCents: number; potentialReturnCents: number }, limit = config.maxMarketLiabilityCents) {
  const single = bet.legs.length === 1;
  for (const leg of bet.legs) {
    const cur = await selectionLiability(q, leg.fixtureId, leg.selection);
    const after = cur.netCents + bet.potentialReturnCents - (single ? bet.stakeCents : 0);
    if (after > limit) {
      const room = limit - cur.netCents;
      throw new AppError('market_limit', 'This bet is above our limit for this market. Try a smaller stake.', 409, {
        fixtureId: leg.fixtureId, selection: leg.selection, ...(single && room > 0 ? { hint: `Try a stake that pays out less than ${formatNad(room + bet.stakeCents)}` } : {}),
      });
    }
  }
}
