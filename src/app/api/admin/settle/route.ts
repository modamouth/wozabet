import { z } from 'zod';
import { handle, ok } from '@/lib/http';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { setResultAndSettle } from '@/lib/settle';
import { AppError } from '@/lib/errors';
import { LIMITS, rateLimit } from '@/lib/ratelimit';

const Body = z.union([
  z.object({ fixtureId: z.string(), cancel: z.literal(true) }),
  z.object({ fixtureId: z.string(), homeScore: z.number().int().min(0).max(300), awayScore: z.number().int().min(0).max(300) }),
]);

export async function POST(req: Request) {
  return handle(async () => {
    const admin = await requireAdmin();
    const db = await getDb();
    await rateLimit(db, `admin:${admin.uid}`, ...LIMITS.adminPerUser);
    const b = Body.parse(await req.json().catch(() => { throw new AppError('invalid', 'Invalid request'); }));
    const r = 'cancel' in b
      ? await setResultAndSettle(db, b.fixtureId, { status: 'cancelled' }, admin.uid)
      : await setResultAndSettle(db, b.fixtureId, { status: 'finished', homeScore: b.homeScore, awayScore: b.awayScore }, admin.uid);
    return ok(r);
  });
}
