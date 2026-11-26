import { handle, ok } from '@/lib/http';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { defaultProviders, syncFixtures, todayAndTomorrow } from '@/lib/sync';
import { AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/** Call every few minutes from a scheduler (Authorization: Bearer $CRON_SECRET). Admins can also trigger it manually. */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  const bearer = req.headers.get('authorization') === `Bearer ${secret}`;
  const s = await getSession();
  if (!(secret && bearer) && s?.role !== 'admin') throw new AppError('forbidden', 'Not allowed', 403);
  return ok(await syncFixtures(await getDb(), defaultProviders(), todayAndTomorrow()));
}
export const GET = (req: Request) => handle(() => run(req));
export const POST = (req: Request) => handle(() => run(req));
