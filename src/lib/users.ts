import crypto from 'node:crypto';
import type { Db, Q } from './db';
import { AppError } from './errors';
import { checkOtp, consumeOtp } from './otp';
import { audit } from './audit';

export function normalizePhone(input: string): string {
  let d = input.replace(/\D/g, '');
  if (d.startsWith('264')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length < 8 || d.length > 9) throw new AppError('bad_phone', 'Enter a valid Namibian mobile number');
  return '+264' + d;
}

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function ageOn(dob: string, today = new Date()): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) throw new AppError('bad_dob', 'Date of birth must be YYYY-MM-DD');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = today.getUTCFullYear() - y;
  if (today.getUTCMonth() + 1 < mo || (today.getUTCMonth() + 1 === mo && today.getUTCDate() < d)) age -= 1;
  return age;
}

export interface NewUser {
  phone: string;
  password: string;
  firstName: string;
  lastName: string;
  dob: string; // YYYY-MM-DD
  role?: 'player' | 'admin';
}

export interface UserRow {
  id: string; phone: string; first_name: string; last_name: string; role: string; kyc_status: string;
  self_excluded_until: Date | null; password_hash: string;
}

/** `otpCode` (from the sign-up SMS) is required by the register route; seed scripts may omit it. */
export async function createUser(db: Db, input: NewUser, opts: { otpCode?: string } = {}): Promise<{ id: string; phone: string; role: string }> {
  const phone = normalizePhone(input.phone);
  if (input.password.length < 8) throw new AppError('weak_password', 'Password must be at least 8 characters');
  if (ageOn(input.dob) < 18) throw new AppError('underage', 'You must be 18 or older to join', 403);
  const id = crypto.randomUUID();
  const role = input.role ?? 'player';
  const otpId = opts.otpCode !== undefined ? await checkOtp(db, phone, 'signup', opts.otpCode) : null;
  return db.tx(async (q: Q) => {
    const dupe = await q('SELECT 1 FROM users WHERE phone=$1', [phone]);
    if (dupe.length) throw new AppError('phone_taken', 'That number is already registered', 409);
    if (otpId !== null) await consumeOtp(q, otpId);
    await q('INSERT INTO users (id, phone, password_hash, first_name, last_name, dob, role, phone_verified_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [
      id, phone, hashPassword(input.password), input.firstName.trim(), input.lastName.trim(), input.dob, role, otpId !== null ? new Date() : null,
    ]);
    await q('INSERT INTO wallets (user_id) VALUES ($1)', [id]);
    await audit(q, { actorId: id, action: 'user.registered', targetType: 'user', targetId: id, details: { role, phoneVerified: otpId !== null } });
    return { id, phone, role };
  });
}

export async function authenticate(db: Db, phoneRaw: string, password: string): Promise<UserRow> {
  const phone = normalizePhone(phoneRaw);
  const rows = await db.q<UserRow>('SELECT * FROM users WHERE phone=$1', [phone]);
  const u = rows[0];
  // Always run a hash comparison so timing doesn't reveal whether the number exists.
  const ok = verifyPassword(password, u?.password_hash ?? 'x:y');
  if (!u || !ok) throw new AppError('bad_credentials', 'Wrong number or password', 401);
  return u;
}
