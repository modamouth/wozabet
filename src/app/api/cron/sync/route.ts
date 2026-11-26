import { handle, ok } from '@/lib/http';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { defaultProviders, syncFixtures, todayAndTomorrow } from '@/lib/sync';
import { AppError } from '@/lib/errors';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** Call every few minutes from a scheduler (Authorization: Bearer $CRON_SECRET). Admins can also trigger it manually. */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  const bearer = req.headers.get('authorization') === `Bearer ${secret}`;
  const s = await getSession();
  if (!(secret && bearer) && s?.role !== 'admin') throw new AppError('forbidden', 'Not allowed', 403);
  const db = await getDb();
  const r = await syncFixtures(db, defaultProviders(), todayAndTomorrow());
  if (!(secret && bearer)) await audit(db.q, { actorId: s!.uid, action: 'admin.sync', details: { fixtures: r.fixtures, errors: r.errors.length } });
  return ok(r);
}
export const GET = (req: Request) => handle(() => run(req));
export const POST = (req: Request) => handle(() => run(req));
