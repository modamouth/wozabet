import { handle, ok } from '@/lib/http';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { adminSummary } from '@/lib/admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    await requireAdmin();
    return ok(await adminSummary(await getDb()));
  });
}
