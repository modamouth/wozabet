import { z } from 'zod';
import { handle, ok } from '@/lib/http';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { LIMITS, rateLimit } from '@/lib/ratelimit';
import { reviewKyc } from '@/lib/kyc';

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('reject'), reason: z.string().trim().min(1, 'Give a reason').max(500) }),
]);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requireAdmin();
    await rateLimit(await getDb(), `admin:${admin.uid}`, ...LIMITS.adminPerUser);
    const { id } = await ctx.params;
    const b = Body.parse(await req.json().catch(() => { throw new AppError('invalid', 'Invalid request'); }));
    return ok(await reviewKyc(await getDb(), admin.uid, id, b));
  });
}
