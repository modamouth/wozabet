import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { authSecret } from './config';
import { AppError } from './errors';
import { getDb } from './db';

const COOKIE = 'wb_session';
const key = () => new TextEncoder().encode(authSecret());

export async function createSession(userId: string, role: string) {
  const token = await new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(userId)
    .setIssuedAt().setExpirationTime('30d').sign(key());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 30,
  });
}
export async function clearSession() {
  (await cookies()).delete(COOKIE);
}
export async function getSession(): Promise<{ uid: string; role: string } | null> {
  const t = (await cookies()).get(COOKIE)?.value;
  if (!t) return null;
  try {
    const { payload } = await jwtVerify(t, key());
    return payload.sub ? { uid: payload.sub, role: String(payload.role ?? 'player') } : null;
  } catch {
    return null;
  }
}
export async function requireUser() {
  const s = await getSession();
  if (!s) throw new AppError('unauthorized', 'Please log in', 401);
  // re-check the user still exists (e.g. DB reset) and pick up role changes
  const u = (await (await getDb()).q<{ role: string }>('SELECT role FROM users WHERE id=$1', [s.uid]))[0];
  if (!u) throw new AppError('unauthorized', 'Please log in', 401);
  return { uid: s.uid, role: u.role };
}
export async function requireAdmin() {
  const u = await requireUser();
  if (u.role !== 'admin') throw new AppError('forbidden', 'Admins only', 403);
  return u;
}

/** Tiny in-memory login throttle: 8 failures per phone per 10 minutes. Use Redis/DB if you run several servers. */
const fails = new Map<string, { n: number; t: number }>();
export function throttleCheck(id: string) {
  const f = fails.get(id);
  if (f && Date.now() - f.t < 600_000 && f.n >= 8) throw new AppError('too_many_attempts', 'Too many attempts. Try again in 10 minutes.', 429);
}
export function throttleFail(id: string) {
  const f = fails.get(id);
  fails.set(id, !f || Date.now() - f.t >= 600_000 ? { n: 1, t: Date.now() } : { n: f.n + 1, t: f.t });
}
export const throttleClear = (id: string) => fails.delete(id);
