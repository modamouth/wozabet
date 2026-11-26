import { handle, ok } from '@/lib/http';
import { getDb } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { rgOverview } from '@/lib/rg';

export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    const u = await requireUser();
    return ok(await rgOverview(await getDb(), u.uid));
  });
}
