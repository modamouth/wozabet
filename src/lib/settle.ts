import type { Db, Q } from './db';
import { AppError } from './errors';
import { credit } from './wallet';
import { legOutcome, resolveBet, type FixtureStatus } from './settle-logic';

/** Record a final result (or cancellation) for a fixture and settle every affected bet. Safe to call twice. */
export async function setResultAndSettle(
  db: Db,
  fixtureId: string,
  r: { status: 'finished'; homeScore: number; awayScore: number } | { status: 'cancelled' },
) {
  return db.tx(async (q: Q) => {
    const fx = (await q<any>('SELECT * FROM fixtures WHERE id=$1 FOR UPDATE', [fixtureId]))[0];
    if (!fx) throw new AppError('no_fixture', 'Fixture not found', 404);
    if (fx.settled) return { alreadySettled: true, legs: 0, bets: 0 };
    if (r.status === 'finished') {
      await q('UPDATE fixtures SET status=$2, home_score=$3, away_score=$4, updated_at=now() WHERE id=$1', [fixtureId, 'finished', r.homeScore, r.awayScore]);
    } else {
      await q("UPDATE fixtures SET status='cancelled', updated_at=now() WHERE id=$1", [fixtureId]);
    }
    return settleLocked(q, fixtureId);
  });
}

/** Settle a fixture that is already marked finished/cancelled (used by the sync job). */
export async function settleFixture(db: Db, fixtureId: string) {
  return db.tx(async (q: Q) => {
    const fx = (await q<any>('SELECT * FROM fixtures WHERE id=$1 FOR UPDATE', [fixtureId]))[0];
    if (!fx || fx.settled) return { alreadySettled: true, legs: 0, bets: 0 };
    return settleLocked(q, fixtureId);
  });
}

async function settleLocked(q: Q, fixtureId: string) {
  const fx = (await q<any>('SELECT * FROM fixtures WHERE id=$1', [fixtureId]))[0];
  const odds = await q<{ selection: string }>('SELECT selection FROM odds WHERE fixture_id=$1', [fixtureId]);
  const hasDraw = odds.some((o) => o.selection === 'X');
  const result = { status: fx.status as FixtureStatus, homeScore: fx.home_score, awayScore: fx.away_score, hasDraw };

  const legs = await q<{ id: number; bet_id: string; selection: string }>(
    "SELECT id, bet_id, selection FROM bet_legs WHERE fixture_id=$1 AND status='open'", [fixtureId]);
  for (const l of legs) {
    const st = legOutcome(l.selection, result);
    if (st !== 'open') await q('UPDATE bet_legs SET status=$2 WHERE id=$1', [l.id, st]);
  }

  let settledBets = 0;
  for (const betId of [...new Set(legs.map((l) => l.bet_id))]) {
    const bet = (await q<any>("SELECT * FROM bets WHERE id=$1 AND status='open' FOR UPDATE", [betId]))[0];
    if (!bet) continue;
    const all = await q<{ status: any; price_milli: number }>('SELECT status, price_milli FROM bet_legs WHERE bet_id=$1', [betId]);
    const res = resolveBet(bet.stake_cents, all.map((l) => ({ status: l.status, priceMilli: l.price_milli })));
    if (res.status === 'open') continue;
    const upd = await q(
      "UPDATE bets SET status=$2, return_cents=$3, settled_at=now() WHERE id=$1 AND status='open' RETURNING id",
      [betId, res.status, res.returnCents],
    );
    if (!upd.length) continue;
    settledBets += 1;
    if (res.status === 'won') await credit(q, bet.user_id, res.returnCents, 'bet_win', betId);
    if (res.status === 'void') await credit(q, bet.user_id, res.returnCents, 'bet_refund', betId);
  }
  if (fx.status === 'finished' || fx.status === 'cancelled') await q('UPDATE fixtures SET settled=true WHERE id=$1', [fixtureId]);
  return { alreadySettled: false, legs: legs.length, bets: settledBets };
}
