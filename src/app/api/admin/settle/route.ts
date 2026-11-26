import { z } from 'zod';
import { handle, ok } from '@/lib/http';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { setResultAndSettle } from '@/lib/settle';
import { AppError } from '@/lib/errors';

const Body = z.union([
  z.object({ fixtureId: z.string(), cancel: z.literal(true) }),
  z.object({ fixtureId: z.string(), homeScore: z.number().int().min(0).max(300), awayScore: z.number().int().min(0).max(300) }),
]);

export async function POST(req: Request) {
  return handle(async () => {
    await requireAdmin();
    const b = Body.parse(await req.json().catch(() => { throw new AppError('invalid', 'Invalid request'); }));
    const db = await getDb();
    const r = 'cancel' in b
      ? await setResultAndSettle(db, b.fixtureId, { status: 'cancelled' })
      : await setResultAndSettle(db, b.fixtureId, { status: 'finished', homeScore: b.homeScore, awayScore: b.awayScore });
    return ok(r);
  });
}
