import { z } from 'zod';
import { handle, ok } from '@/lib/http';
import { getDb } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { listBets, placeBet } from '@/lib/bets';
import { getBalance } from '@/lib/wallet';
import { AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const Body = z.object({
  stakeCents: z.number().int(),
  selections: z.array(z.object({ fixtureId: z.string(), selection: z.enum(['1', 'X', '2']), priceMilli: z.number().int() })).min(1).max(20),
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
    const b = Body.parse(await req.json().catch(() => { throw new AppError('invalid', 'Invalid request'); }));
    const db = await getDb();
    const bet = await placeBet(db, u.uid, b);
    return ok({ bet, balanceCents: await getBalance(db.q, u.uid) }, 201);
  });
}
