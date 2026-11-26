import { z } from 'zod';
import { handle, ok } from '@/lib/http';
import { getDb } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { LIMITS, rateLimit } from '@/lib/ratelimit';
import { setLimit } from '@/lib/rg';

const Body = z.object({ kind: z.enum(['deposit', 'loss']), period: z.enum(['day', 'week', 'month']), amountCents: z.number().int().nullable() });

export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser();
    await rateLimit(await getDb(), `rg:${u.uid}`, ...LIMITS.rgPerUser);
    const b = Body.parse(await req.json().catch(() => { throw new AppError('invalid', 'Invalid request'); }));
    return ok(await setLimit(await getDb(), u.uid, b.kind, b.period, b.amountCents));
  });
}
