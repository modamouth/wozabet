import { createPgliteDb, type Db } from '@/lib/db';
import { createUser } from '@/lib/users';

let n = 0;
/** Fresh in-memory Postgres per test, also installed as the app singleton so route handlers use it. */
export async function freshDb(): Promise<Db> {
  const db = await createPgliteDb();
  (globalThis as any).__wozaDb = Promise.resolve(db);
  return db;
}
export async function makeUser(db: Db, extra: { role?: 'player' | 'admin'; kyc?: string } = {}) {
  n += 1;
  const u = await createUser(db, { phone: `08130${String(n).padStart(5, '0')}`, password: 'secret-pass', firstName: 'T', lastName: `User${n}`, dob: '1990-01-01', role: extra.role });
  if (extra.kyc) await db.q('UPDATE users SET kyc_status=$2 WHERE id=$1', [u.id, extra.kyc]);
  return u;
}
export async function ledgerSum(db: Db, uid: string) {
  return (await db.q<{ s: number }>('SELECT COALESCE(SUM(amount_cents),0)::int AS s FROM ledger WHERE user_id=$1', [uid]))[0].s;
}
