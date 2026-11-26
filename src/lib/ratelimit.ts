import type { Db } from './db';
import { AppError } from './errors';

/**
 * Fixed-window rate limiter stored in Postgres, so it holds across several app servers and restarts.
 * One atomic upsert per check. Old windows are cleaned up opportunistically.
 */
export async function hit(db: Db, key: string, limit: number, windowSec: number, now = new Date()): Promise<{ ok: boolean; count: number; retryAfterSec: number }> {
  const startMs = Math.floor(now.getTime() / (windowSec * 1000)) * windowSec * 1000;
  const r = await db.q<{ count: number }>(
    `INSERT INTO rate_limits (key, window_start, count, expires_at) VALUES ($1, $2, 1, $3)
     ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1 RETURNING count`,
    [key.slice(0, 200), new Date(startMs), new Date(startMs + windowSec * 1000)]);
  if (Math.random() < 0.01) void db.q('DELETE FROM rate_limits WHERE expires_at < now()').catch(() => {});
  const count = r[0].count;
  return { ok: count <= limit, count, retryAfterSec: Math.max(1, Math.ceil((startMs + windowSec * 1000 - now.getTime()) / 1000)) };
}

export async function rateLimit(db: Db, key: string, limit: number, windowSec: number, message = 'Too many requests. Please wait and try again.') {
  const r = await hit(db, key, limit, windowSec);
  if (!r.ok) throw new AppError('rate_limited', message, 429, { retryAfterSec: r.retryAfterSec });
}

/** How many hits a key has in its current window (without adding one). */
export async function peek(db: Db, key: string, windowSec: number, now = new Date()) {
  const startMs = Math.floor(now.getTime() / (windowSec * 1000)) * windowSec * 1000;
  const r = await db.q<{ count: number }>('SELECT count FROM rate_limits WHERE key=$1 AND window_start=$2', [key, new Date(startMs)]);
  return r[0]?.count ?? 0;
}
export async function clearKey(db: Db, key: string) {
  await db.q('DELETE FROM rate_limits WHERE key=$1', [key]);
}

/**
 * The caller's IP. Only trust X-Forwarded-For when TRUST_PROXY=true (i.e. the app is behind your own load balancer),
 * otherwise anyone could fake it to dodge limits.
 */
export function clientIp(req: Request, env: Record<string, string | undefined> = process.env): string {
  if (env.TRUST_PROXY === 'true') {
    const xff = req.headers.get('x-forwarded-for');
    if (xff) return xff.split(',')[0].trim().slice(0, 64);
    const real = req.headers.get('x-real-ip');
    if (real) return real.trim().slice(0, 64);
  }
  return 'direct';
}

/** Standard limits, in one place. [limit, windowSeconds] */
export const LIMITS = {
  loginPerIp: [20, 600],
  loginFailPerPhone: [8, 600],
  registerPerIp: [10, 3600],
  otpSendPerPhone: [5, 3600],
  otpResendGap: [1, 60],
  otpSendPerIp: [30, 3600],
  betsPerUser: [30, 60],
  depositsPerUser: [10, 600],
  withdrawalsPerUser: [5, 3600],
  kycPerUser: [5, 3600],
  rgPerUser: [30, 600],
  adminPerUser: [120, 60],
  webhookPerIp: [600, 60],
} as const satisfies Record<string, readonly [number, number]>;
