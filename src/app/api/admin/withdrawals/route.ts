import { handle, ok } from '@/lib/http';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { listWithdrawals, type WithdrawalStatus } from '@/lib/withdrawals';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return handle(async () => {
    await requireAdmin();
    const s = new URL(req.url).searchParams.get('status');
    const status = (['pending', 'approved', 'rejected'] as const).includes(s as WithdrawalStatus) ? (s as WithdrawalStatus) : 'pending';
    return ok({ withdrawals: await listWithdrawals(await getDb(), { status }) });
  });
}
