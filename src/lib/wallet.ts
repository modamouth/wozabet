import type { Db, Q } from './db';
import { AppError } from './errors';

export type LedgerType = 'deposit' | 'withdrawal' | 'bet_stake' | 'bet_win' | 'bet_refund' | 'bonus';

/** Add money. `ref` makes the entry idempotent (same type+ref can only be booked once). */
export async function credit(q: Q, userId: string, cents: number, type: LedgerType, ref?: string): Promise<number> {
  if (!Number.isInteger(cents) || cents <= 0) throw new AppError('bad_amount', 'Amount must be a positive whole number of cents');
  if (ref) {
    // idempotency: check BEFORE touching the balance (the unique index is the backstop for races)
    const dupe = await q('SELECT 1 FROM ledger WHERE type=$1 AND ref=$2', [type, ref]);
    if (dupe.length) throw new AppError('duplicate_ref', 'This transaction was already processed', 409);
  }
  const rows = await q<{ balance_cents: number }>(
    'UPDATE wallets SET balance_cents = balance_cents + $2 WHERE user_id = $1 RETURNING balance_cents',
    [userId, cents],
  );
  if (!rows[0]) throw new AppError('no_wallet', 'Wallet not found', 404);
  await q('INSERT INTO ledger (user_id, type, amount_cents, balance_after_cents, ref) VALUES ($1,$2,$3,$4,$5)', [
    userId, type, cents, rows[0].balance_cents, ref ?? null,
  ]);
  return rows[0].balance_cents;
}

/** Remove money atomically; fails (without going negative) if funds are insufficient. */
export async function debit(q: Q, userId: string, cents: number, type: LedgerType, ref?: string): Promise<number> {
  if (!Number.isInteger(cents) || cents <= 0) throw new AppError('bad_amount', 'Amount must be a positive whole number of cents');
  const rows = await q<{ balance_cents: number }>(
    'UPDATE wallets SET balance_cents = balance_cents - $2 WHERE user_id = $1 AND balance_cents >= $2 RETURNING balance_cents',
    [userId, cents],
  );
  if (!rows[0]) throw new AppError('insufficient_funds', 'Insufficient balance', 402);
  await q('INSERT INTO ledger (user_id, type, amount_cents, balance_after_cents, ref) VALUES ($1,$2,$3,$4,$5)', [
    userId, type, -cents, rows[0].balance_cents, ref ?? null,
  ]);
  return rows[0].balance_cents;
}

export async function getBalance(q: Q, userId: string): Promise<number> {
  const r = await q<{ balance_cents: number }>('SELECT balance_cents FROM wallets WHERE user_id=$1', [userId]);
  return r[0]?.balance_cents ?? 0;
}

/** Book a deposit (e.g. from a payment webhook) atomically and idempotently by the provider's reference. */
export const deposit = (db: Db, userId: string, cents: number, ref: string) =>
  db.tx((q) => credit(q, userId, cents, 'deposit', ref));
