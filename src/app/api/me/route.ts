import { handle, ok } from '@/lib/http';
import { getSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    const s = await getSession();
    const flags = { demoMode: config.demoMode, liveBetting: config.liveBetting, minStakeCents: config.minStakeCents, maxStakeCents: config.maxStakeCents };
    if (!s) return ok({ user: null, ...flags });
    const db = await getDb();
    const r = await db.q<any>(
      'SELECT u.id, u.phone, u.first_name, u.last_name, u.role, u.kyc_status, w.balance_cents FROM users u JOIN wallets w ON w.user_id=u.id WHERE u.id=$1',
      [s.uid],
    );
    if (!r[0]) return ok({ user: null, ...flags });
    const u = r[0];
    return ok({ user: { id: u.id, phone: u.phone, firstName: u.first_name, lastName: u.last_name, role: u.role, kycStatus: u.kyc_status, balanceCents: u.balance_cents }, ...flags });
  });
}
