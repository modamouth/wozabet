import crypto from 'node:crypto';
import type { Db, Q } from './db';
import { AppError } from './errors';
import { authSecret } from './config';
import type { SmsSender } from './sms';

/** One-time SMS codes for sign-up and withdrawals. Only an HMAC of the code is stored. */
export type OtpPurpose = 'signup' | 'withdrawal';
export const OTP_TTL_SECONDS = 300;
export const OTP_MAX_ATTEMPTS = 5;

const hashCode = (phone: string, purpose: OtpPurpose, code: string) =>
  crypto.createHmac('sha256', authSecret()).update(`${purpose}:${phone}:${code}`).digest('hex');

/** Create a fresh code (invalidating older ones for the same phone+purpose) and text it. Returns the code for tests only; never send it to a client. */
export async function issueOtp(db: Db, sms: SmsSender, phone: string, purpose: OtpPurpose, now = new Date()): Promise<{ code: string; expiresAt: Date }> {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const expiresAt = new Date(now.getTime() + OTP_TTL_SECONDS * 1000);
  await db.tx(async (q) => {
    await q("UPDATE otp_codes SET consumed_at=$3 WHERE phone=$1 AND purpose=$2 AND consumed_at IS NULL", [phone, purpose, now]);
    await q('INSERT INTO otp_codes (phone, purpose, code_hash, expires_at, created_at) VALUES ($1,$2,$3,$4,$5)', [phone, purpose, hashCode(phone, purpose, code), expiresAt, now]);
  });
  const what = purpose === 'signup' ? 'Wozabet sign-up' : 'Wozabet withdrawal';
  try {
    await sms.send(phone, `${code} is your ${what} code. It expires in 5 minutes. Never share it with anyone.`);
  } catch {
    throw new AppError('sms_failed', 'We could not send the SMS. Please try again.', 502);
  }
  return { code, expiresAt };
}

/**
 * Step 1 — check a code in its OWN short transaction, BEFORE the caller starts theirs. A wrong guess increments the
 * attempt counter and commits, so it can't be reset by the caller rolling back. After OTP_MAX_ATTEMPTS the code is burned.
 * Returns the code's id for consumeOtp().
 */
export async function checkOtp(db: Db, phone: string, purpose: OtpPurpose, code: string, now = new Date()): Promise<number> {
  if (!/^\d{6}$/.test(code ?? '')) throw new AppError('otp_invalid', 'Enter the 6-digit code we sent you');
  const res = await db.tx(async (q) => {
    const row = (await q<{ id: number; code_hash: string; attempts: number; expires_at: Date }>(
      'SELECT id, code_hash, attempts, expires_at FROM otp_codes WHERE phone=$1 AND purpose=$2 AND consumed_at IS NULL ORDER BY id DESC LIMIT 1 FOR UPDATE',
      [phone, purpose]))[0];
    if (!row || new Date(row.expires_at) <= now || row.attempts >= OTP_MAX_ATTEMPTS) return { err: 'expired' as const };
    const a = Buffer.from(row.code_hash, 'hex');
    const b = Buffer.from(hashCode(phone, purpose, code), 'hex');
    if (!crypto.timingSafeEqual(a, b)) {
      await q('UPDATE otp_codes SET attempts = attempts + 1 WHERE id=$1', [row.id]);
      return { err: 'invalid' as const };
    }
    return { id: row.id };
  });
  if ('err' in res) {
    if (res.err === 'expired') throw new AppError('otp_expired', 'That code has expired. Request a new one.');
    throw new AppError('otp_invalid', 'That code is not right. Check the SMS and try again.');
  }
  return res.id;
}

/** Step 2 — mark the code used INSIDE the caller's transaction (so it is only used up if the action commits). One use only. */
export async function consumeOtp(q: Q, otpId: number, now = new Date()) {
  const r = await q('UPDATE otp_codes SET consumed_at=$2 WHERE id=$1 AND consumed_at IS NULL RETURNING id', [otpId, now]);
  if (!r.length) throw new AppError('otp_expired', 'That code has already been used. Request a new one.');
}
