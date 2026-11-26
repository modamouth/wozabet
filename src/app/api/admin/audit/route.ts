import { handle, ok } from '@/lib/http';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { listAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return handle(async () => {
    await requireAdmin();
    const sp = new URL(req.url).searchParams;
    return ok({ entries: await listAudit((await getDb()).q, { action: sp.get('action') || undefined, targetId: sp.get('target') || undefined, limit: 300 }) });
  });
}
