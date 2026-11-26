import { z } from 'zod';
import { handle, ok } from '@/lib/http';
import { getDb } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { requestWithdrawal } from '@/lib/withdrawals';

const Body = z.object({ amountCents: z.number().int() });

export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser();
    const b = Body.parse(await req.json().catch(() => { throw new AppError('invalid', 'Invalid request'); }));
    return ok({ withdrawal: await requestWithdrawal(await getDb(), u.uid, b.amountCents) }, 201);
  });
}
