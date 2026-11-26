import { z } from 'zod';
import { handle, ok } from '@/lib/http';
import { getDb } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { listBets, placeBet } from '@/lib/bets';
import { getBalance } from '@/lib/wallet';
import { AppError } from '@/lib/errors';
import { LIMITS, rateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

const Body = z.object({
  stakeCents: z.number().int(),
  selections: z.array(z.object({ fixtureId: z.string().max(64), market: z.enum(['1x2', 'dc', 'ou25', 'btts']), selection: z.string().max(4), priceMilli: z.number().int().positive() })).min(1).max(20),
});

export async function GET() {
  return handle(async () => {
    const u = await requireUser();
    return ok({ bets: await listBets(await getDb(), u.uid) });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser();
    const db = await getDb();
    await rateLimit(db, `bets:${u.uid}`, ...LIMITS.betsPerUser);
    const b = Body.parse(await req.json().catch(() => { throw new AppError('invalid', 'Invalid request'); }));
    const bet = await placeBet(db, u.uid, b);
    return ok({ bet, balanceCents: await getBalance(db.q, u.uid) }, 201);
  });
}
