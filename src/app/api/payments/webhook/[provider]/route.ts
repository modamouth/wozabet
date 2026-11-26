import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { getPaymentProvider } from '@/lib/payments';
import { applyPaymentEvent } from '@/lib/payments/service';
import { LIMITS, clientIp, hit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

const err = (status: number, code: string) => NextResponse.json({ error: { code } }, { status });

/** Provider callback. The signature is checked against the RAW body before anything is parsed or trusted. */
export async function POST(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider: name } = await ctx.params;
  let provider;
  try { provider = getPaymentProvider(); } catch { return err(503, 'payments_misconfigured'); }
  if (!provider || provider.name !== name) return err(404, 'unknown_provider');

  const db = await getDb();
  if (!(await hit(db, `webhook:${clientIp(req)}`, ...LIMITS.webhookPerIp)).ok) return err(429, 'rate_limited');
  const raw = await req.text();
  if (raw.length > 64_000) return err(413, 'too_large');
  if (!provider.verifyWebhook(raw, req.headers)) return err(401, 'bad_signature');

  let ev;
  try { ev = provider.parseWebhook(raw); } catch { return err(400, 'bad_payload'); }
  try {
    const r = await applyPaymentEvent(db, provider.name, ev);
    // 200 even for 'review' or a replay: the event was received; retries would not change the outcome
    return NextResponse.json({ ok: true, status: r.status });
  } catch (e) {
    if (e instanceof AppError && e.code === 'unknown_payment') return err(404, 'unknown_payment');
    console.error('payment webhook failed', e);
    return err(500, 'server_error'); // provider will retry
  }
}
