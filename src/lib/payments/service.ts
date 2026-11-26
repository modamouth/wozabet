import crypto from 'node:crypto';
import type { Db } from '../db';
import { AppError } from '../errors';
import { config } from '../config';
import { formatNad } from '../money';
import { depositInTx } from '../wallet';
import { assertDepositAllowed } from '../rg';
import type { PaymentEvent, PaymentProvider } from './types';

export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'review';

export interface DepositLimits { minCents: number; maxCents: number }
const defaultLimits = (): DepositLimits => ({ minCents: config.minDepositCents, maxCents: config.maxDepositCents });

/**
 * Start a deposit: record a pending payment, then ask the provider to push a payment request to the user's
 * REGISTERED phone (we never let the client choose the paying number). Nothing is credited here; money only
 * arrives through a verified webhook (applyPaymentEvent).
 */
export async function initiateDeposit(
  db: Db, provider: PaymentProvider,
  input: { userId: string; amountCents: number; callbackUrl: string; limits?: DepositLimits },
) {
  const { userId, amountCents } = input;
  const limits = input.limits ?? defaultLimits();
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new AppError('bad_amount', 'Amount must be a whole number of cents');
  if (amountCents < limits.minCents) throw new AppError('deposit_too_low', `Minimum deposit is ${formatNad(limits.minCents)}`);
  if (amountCents > limits.maxCents) throw new AppError('deposit_too_high', `Maximum deposit is ${formatNad(limits.maxCents)}`);

  const id = crypto.randomUUID();
  const msisdn = await db.tx(async (q) => {
    const u = (await q<{ phone: string }>('SELECT phone FROM users WHERE id=$1 FOR UPDATE', [userId]))[0];
    if (!u) throw new AppError('no_user', 'User not found', 404);
    // self-exclusion, cool-off and deposit limits (pending payments count towards the limit)
    await assertDepositAllowed(q, userId, amountCents);
    const m = u.phone.replace(/^\+/, '');
    await q('INSERT INTO payments (id, user_id, provider, amount_cents, msisdn) VALUES ($1,$2,$3,$4,$5)', [id, userId, provider.name, amountCents, m]);
    return m;
  });

  try {
    const { providerRef } = await provider.initiateCollection({ reference: id, amountCents, msisdn, callbackUrl: input.callbackUrl });
    if (providerRef) await db.q('UPDATE payments SET provider_ref=$2, updated_at=now() WHERE id=$1', [id, providerRef]);
    return { id, status: 'pending' as PaymentStatus, amountCents };
  } catch (e) {
    await db.q("UPDATE payments SET status='failed', failure_reason=$2, updated_at=now() WHERE id=$1 AND status='pending'", [id, `initiation: ${(e as Error).message}`.slice(0, 500)]);
    throw new AppError('provider_unavailable', 'The payment provider could not be reached. Please try again.', 502);
  }
}

/**
 * Apply a VERIFIED provider webhook. Idempotent: replays of the same event are no-ops, and the ledger's
 * unique (type, ref) index is the final backstop against a double credit.
 * Anything suspicious (amount/currency/reference mismatch, success after failure) is parked in 'review' and NOT
 * credited, so an admin can check it against the provider's statement.
 */
export async function applyPaymentEvent(db: Db, providerName: string, ev: PaymentEvent) {
  return db.tx(async (q) => {
    const p = (await q<any>('SELECT * FROM payments WHERE id=$1 AND provider=$2 FOR UPDATE', [ev.reference, providerName]))[0];
    if (!p) throw new AppError('unknown_payment', 'Unknown payment reference', 404);
    const review = async (why: string) => {
      await q("UPDATE payments SET status='review', failure_reason=$2, updated_at=now() WHERE id=$1", [p.id, why.slice(0, 500)]);
      return { id: p.id, status: 'review' as PaymentStatus, changed: true };
    };

    if (p.status === 'completed' || p.status === 'review') return { id: p.id, status: p.status as PaymentStatus, changed: false };
    if (p.provider_ref && p.provider_ref !== ev.providerRef) return review(`provider ref mismatch: expected ${p.provider_ref}, got ${ev.providerRef}`);

    if (ev.status === 'failed') {
      if (p.status === 'failed') return { id: p.id, status: 'failed' as PaymentStatus, changed: false };
      await q("UPDATE payments SET status='failed', provider_ref=$2, failure_reason=$3, updated_at=now() WHERE id=$1",
        [p.id, ev.providerRef, (ev.failureReason ?? 'declined').slice(0, 500)]);
      return { id: p.id, status: 'failed' as PaymentStatus, changed: true };
    }

    // succeeded
    if (p.status === 'failed') return review('success received after the payment was marked failed');
    if (ev.currency !== 'NAD') return review(`currency mismatch: ${ev.currency}`);
    if (ev.amountCents !== p.amount_cents) return review(`amount mismatch: expected ${p.amount_cents}, got ${ev.amountCents}`);

    await depositInTx(q, p.user_id, p.amount_cents, `${providerName}:${ev.providerRef}`);
    await q("UPDATE payments SET status='completed', provider_ref=$2, updated_at=now() WHERE id=$1", [p.id, ev.providerRef]);
    return { id: p.id, status: 'completed' as PaymentStatus, changed: true };
  });
}

export async function listPayments(db: Db, userId: string) {
  const rows = await db.q<any>('SELECT id, amount_cents, status, created_at FROM payments WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50', [userId]);
  return rows.map((r: any) => ({ id: r.id, amountCents: r.amount_cents, status: r.status, createdAt: r.created_at }));
}
