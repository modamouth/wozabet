import { z } from 'zod';
import { handle, ok } from '@/lib/http';
import { getDb } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { LIMITS, rateLimit } from '@/lib/ratelimit';
import { setSessionReminder } from '@/lib/rg';

const Body = z.object({ minutes: z.number().int().nullable() });

export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser();
    await rateLimit(await getDb(), `rg:${u.uid}`, ...LIMITS.rgPerUser);
    const b = Body.parse(await req.json().catch(() => { throw new AppError('invalid', 'Invalid request'); }));
    return ok(await setSessionReminder(await getDb(), u.uid, b.minutes));
  });
}
