import crypto from 'node:crypto';
import type { Db } from './db';
import { AppError } from './errors';
import { config } from './config';
import { formatNad } from './money';
import { credit, debit } from './wallet';

export type WithdrawalStatus = 'pending' | 'approved' | 'rejected';

/**
 * Request a withdrawal. The user must be KYC-verified. The amount is taken out of the wallet immediately
 * (ledger 'withdrawal'), so it can't be bet or withdrawn twice while an admin reviews it. Payout goes to the
 * user's REGISTERED mobile number only.
 */
export async function requestWithdrawal(db: Db, userId: string, amountCents: number, limits = { minCents: config.minWithdrawalCents, maxCents: config.maxWithdrawalCents }) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new AppError('bad_amount', 'Amount must be a whole number of cents');
  if (amountCents < limits.minCents) throw new AppError('withdrawal_too_low', `Minimum withdrawal is ${formatNad(limits.minCents)}`);
  if (amountCents > limits.maxCents) throw new AppError('withdrawal_too_high', `Maximum withdrawal is ${formatNad(limits.maxCents)}`);
  return db.tx(async (q) => {
    const u = (await q<{ phone: string; kyc_status: string }>('SELECT phone, kyc_status FROM users WHERE id=$1 FOR UPDATE', [userId]))[0];
    if (!u) throw new AppError('no_user', 'User not found', 404);
    if (u.kyc_status !== 'verified') throw new AppError('kyc_required', 'Verify your identity before withdrawing', 403);
    const id = crypto.randomUUID();
    const balance = await debit(q, userId, amountCents, 'withdrawal', id);
    await q('INSERT INTO withdrawals (id, user_id, amount_cents, msisdn) VALUES ($1,$2,$3,$4)', [id, userId, amountCents, u.phone.replace(/^\+/, '')]);
    return { id, status: 'pending' as WithdrawalStatus, amountCents, balanceCents: balance };
  });
}

/**
 * Admin decision. Only a pending request can be decided, and only once (the status update is the lock).
 * Reject returns the money to the wallet (ledger 'withdrawal_reversal'). Approve means the payout is to be sent
 * to the user's mobile wallet; the money already left the balance at request time.
 */
export async function reviewWithdrawal(db: Db, adminId: string, withdrawalId: string, decision: { action: 'approve' } | { action: 'reject'; reason: string }) {
  if (decision.action === 'reject' && !decision.reason?.trim()) throw new AppError('reason_required', 'Give a reason for rejecting');
  return db.tx(async (q) => {
    const w = (await q<any>('SELECT * FROM withdrawals WHERE id=$1 FOR UPDATE', [withdrawalId]))[0];
    if (!w) throw new AppError('not_found', 'Withdrawal not found', 404);
    if (w.status !== 'pending') throw new AppError('not_pending', `This withdrawal is already ${w.status}`, 409);
    if (w.user_id === adminId) throw new AppError('forbidden', 'You cannot review your own withdrawal', 403);
    const status: WithdrawalStatus = decision.action === 'approve' ? 'approved' : 'rejected';
    await q("UPDATE withdrawals SET status=$2, reviewed_by=$3, reviewed_at=now(), reason=$4 WHERE id=$1 AND status='pending'",
      [withdrawalId, status, adminId, decision.action === 'reject' ? decision.reason.trim().slice(0, 500) : null]);
    if (status === 'rejected') await credit(q, w.user_id, w.amount_cents, 'withdrawal_reversal', withdrawalId);
    return { id: withdrawalId, status, userId: w.user_id as string, amountCents: w.amount_cents as number };
  });
}

export async function listWithdrawals(db: Db, opts: { userId?: string; status?: WithdrawalStatus }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.userId) { params.push(opts.userId); where.push(`w.user_id=$${params.length}`); }
  if (opts.status) { params.push(opts.status); where.push(`w.status=$${params.length}`); }
  const rows = await db.q<any>(
    `SELECT w.*, u.first_name, u.last_name, u.phone, u.kyc_status FROM withdrawals w JOIN users u ON u.id=w.user_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY w.created_at DESC LIMIT 200`, params);
  return rows.map((r: any) => ({
    id: r.id, userId: r.user_id, name: `${r.first_name} ${r.last_name}`, phone: r.phone, kycStatus: r.kyc_status,
    amountCents: r.amount_cents, msisdn: r.msisdn, status: r.status as WithdrawalStatus, reason: r.reason, createdAt: r.created_at, reviewedAt: r.reviewed_at,
  }));
}
