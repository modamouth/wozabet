import crypto from 'node:crypto';
import { z } from 'zod';
import { handle, ok } from '@/lib/http';
import { getDb } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { config } from '@/lib/config';
import { depositInTx } from '@/lib/wallet';
import { assertDepositAllowed } from '@/lib/rg';
import { AppError } from '@/lib/errors';

const Body = z.object({ amountCents: z.number().int().min(100).max(1_000_000) });

/** Play-money top-up for development ONLY. Disabled unless DEMO_MODE=true. Replace with a real payment webhook that calls deposit(). */
export async function POST(req: Request) {
  return handle(async () => {
    if (!config.demoMode) throw new AppError('disabled', 'Demo deposits are disabled', 403);
    const u = await requireUser();
    const b = Body.parse(await req.json().catch(() => { throw new AppError('invalid', 'Invalid request'); }));
    const balance = await (await getDb()).tx(async (q) => {
      await q('SELECT 1 FROM users WHERE id=$1 FOR UPDATE', [u.uid]);
      await assertDepositAllowed(q, u.uid, b.amountCents); // limits apply to play money too, so they can be tried out
      return depositInTx(q, u.uid, b.amountCents, 'demo-' + crypto.randomUUID());
    });
    return ok({ balanceCents: balance });
  });
}
