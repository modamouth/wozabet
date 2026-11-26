import { z } from 'zod';
import { handle, ok } from '@/lib/http';
import { getDb } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { requestWithdrawal } from '@/lib/withdrawals';
import { LIMITS, rateLimit } from '@/lib/ratelimit';

const Body = z.object({ amountCents: z.number().int(), otpCode: z.string() });

export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser();
    const db = await getDb();
    await rateLimit(db, `withdraw:${u.uid}`, ...LIMITS.withdrawalsPerUser);
    const b = Body.parse(await req.json().catch(() => { throw new AppError('invalid', 'Invalid request'); }));
    return ok({ withdrawal: await requestWithdrawal(db, u.uid, b.amountCents, { otpCode: b.otpCode }) }, 201);
  });
}
