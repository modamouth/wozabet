import { handle, ok } from '@/lib/http';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { listKycSubmissions } from '@/lib/kyc';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return handle(async () => {
    await requireAdmin();
    const s = new URL(req.url).searchParams.get('status');
    const status = s === 'approved' || s === 'rejected' ? s : 'submitted';
    return ok({ submissions: await listKycSubmissions(await getDb(), status) });
  });
}
