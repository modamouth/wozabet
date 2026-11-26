import { handle, ok } from '@/lib/http';
import { getDb } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { listPayments } from '@/lib/payments/service';
import { listWithdrawals } from '@/lib/withdrawals';

export const dynamic = 'force-dynamic';

/** The current user's deposits and withdrawals. */
export async function GET() {
  return handle(async () => {
    const u = await requireUser();
    const db = await getDb();
    const withdrawals = (await listWithdrawals(db, { userId: u.uid })).map(({ id, amountCents, status, reason, createdAt }) => ({ id, amountCents, status, reason, createdAt }));
    return ok({ deposits: await listPayments(db, u.uid), withdrawals });
  });
}
