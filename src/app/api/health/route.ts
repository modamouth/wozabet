import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';
const started = Date.now();

/** Liveness + readiness for load balancers, Docker and uptime monitors. 200 when the database answers, else 503. No secrets, no user data. */
export async function GET() {
  const t0 = Date.now();
  let db: 'ok' | 'down' = 'down';
  try {
    const r = await Promise.race([
      (async () => (await getDb()).q<{ ok: number }>('SELECT 1 AS ok'))(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('db timeout')), 3000)),
    ]);
    if (r[0]?.ok === 1) db = 'ok';
  } catch (e) {
    log.error('health: database check failed', { err: e });
  }
  const body = {
    status: db === 'ok' ? 'ok' : 'degraded',
    checks: { database: db },
    latencyMs: Date.now() - t0,
    uptimeSec: Math.round((Date.now() - started) / 1000),
    version: process.env.APP_VERSION || process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'dev',
  };
  return NextResponse.json(body, { status: db === 'ok' ? 200 : 503, headers: { 'cache-control': 'no-store' } });
}
