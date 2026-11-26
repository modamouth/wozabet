import crypto from 'node:crypto';
import type { Db, Q } from './db';
import { AppError } from './errors';
import { config } from './config';
import { debit } from './wallet';
import { potentialReturnCents, totalOddsMilli } from './odds';
import { assertStakeAllowed } from './rg';

export interface SelectionInput { fixtureId: string; selection: string; priceMilli: number }

interface LegCheckRow {
  id: string; status: string; kickoff: Date; price_milli: number | null; suspended: boolean | null;
}

export async function placeBet(db: Db, userId: string, input: { stakeCents: number; selections: SelectionInput[] }) {
  const { stakeCents, selections } = input;
  if (!Number.isInteger(stakeCents)) throw new AppError('bad_stake', 'Stake must be a whole number of cents');
  if (stakeCents < config.minStakeCents) throw new AppError('stake_too_low', `Minimum stake is N$ ${(config.minStakeCents / 100).toFixed(2)}`);
  if (stakeCents > config.maxStakeCents) throw new AppError('stake_too_high', `Maximum stake is N$ ${(config.maxStakeCents / 100).toFixed(2)}`);
  if (selections.length < 1 || selections.length > config.maxLegs) throw new AppError('bad_selections', `Choose 1 to ${config.maxLegs} selections`);
  if (new Set(selections.map((s) => s.fixtureId)).size !== selections.length) {
    throw new AppError('same_match', 'You can only pick one outcome per match');
  }

  return db.tx(async (q: Q) => {
    // lock the user row so concurrent bets can't both slip under a loss limit
    const u = await q('SELECT 1 FROM users WHERE id=$1 FOR UPDATE', [userId]);
    if (!u[0]) throw new AppError('no_user', 'User not found', 404);
    await assertStakeAllowed(q, userId, stakeCents);

    const changed: SelectionInput[] = [];
    const unavailable: string[] = [];
    for (const s of selections) {
      const r = await q<LegCheckRow>(
        `SELECT f.id, f.status, f.kickoff, o.price_milli, o.suspended
           FROM fixtures f LEFT JOIN odds o ON o.fixture_id = f.id AND o.selection = $2 WHERE f.id = $1`,
        [s.fixtureId, s.selection],
      );
      const row = r[0];
      const open = row && (row.status === 'scheduled' || (config.liveBetting && row.status === 'live'));
      const timeOk = row && (row.status === 'live' || new Date(row.kickoff) > new Date());
      if (!row || row.price_milli === null || row.suspended || !open || !timeOk) {
        unavailable.push(s.fixtureId);
      } else if (row.price_milli !== s.priceMilli) {
        changed.push({ fixtureId: s.fixtureId, selection: s.selection, priceMilli: row.price_milli });
      }
    }
    if (unavailable.length) throw new AppError('unavailable', 'One or more selections are no longer available', 409, { unavailable });
    if (changed.length) throw new AppError('price_changed', 'Odds have changed', 409, { changed });

    const total = totalOddsMilli(selections.map((s) => s.priceMilli));
    const potential = potentialReturnCents(stakeCents, total);
    if (potential > config.maxPayoutCents) {
      throw new AppError('payout_limit', `Maximum payout is N$ ${(config.maxPayoutCents / 100).toFixed(2)}. Lower your stake.`);
    }

    const betId = crypto.randomUUID();
    await debit(q, userId, stakeCents, 'bet_stake', betId);
    await q(
      `INSERT INTO bets (id, user_id, kind, stake_cents, total_odds_milli, potential_return_cents) VALUES ($1,$2,$3,$4,$5,$6)`,
      [betId, userId, selections.length > 1 ? 'accumulator' : 'single', stakeCents, total, potential],
    );
    for (const s of selections) {
      await q('INSERT INTO bet_legs (bet_id, fixture_id, selection, price_milli) VALUES ($1,$2,$3,$4)', [betId, s.fixtureId, s.selection, s.priceMilli]);
    }
    return { id: betId, stakeCents, totalOddsMilli: total, potentialReturnCents: potential };
  });
}

export async function listBets(db: Db, userId: string) {
  const bets = await db.q<any>('SELECT * FROM bets WHERE user_id=$1 ORDER BY placed_at DESC LIMIT 100', [userId]);
  if (!bets.length) return [];
  const legs = await db.q<any>(
    `SELECT l.bet_id, l.selection, l.price_milli, l.status, f.home, f.away, f.league, f.kickoff
       FROM bet_legs l JOIN fixtures f ON f.id = l.fixture_id WHERE l.bet_id = ANY($1::text[]) ORDER BY l.id`,
    [bets.map((b: any) => b.id)],
  );
  return bets.map((b: any) => ({
    id: b.id, kind: b.kind, status: b.status, stakeCents: b.stake_cents, totalOddsMilli: b.total_odds_milli,
    potentialReturnCents: b.potential_return_cents, returnCents: b.return_cents, placedAt: b.placed_at,
    legs: legs.filter((l: any) => l.bet_id === b.id).map((l: any) => ({
      selection: l.selection, priceMilli: l.price_milli, status: l.status, home: l.home, away: l.away, league: l.league, kickoff: l.kickoff,
    })),
  }));
}
