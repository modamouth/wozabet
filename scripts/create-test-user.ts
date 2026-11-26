/**
 * Create a TEST player account directly (bypasses the SMS step, which needs an SMS provider).
 * Reads TEST_USER_PHONE / TEST_USER_PASSWORD from the environment. No money is added.
 *   DATABASE_URL=... npx tsx scripts/create-test-user.ts
 * Delete test accounts before launch (they show as "Test Player" in admin screens).
 */
import { getDb } from '../src/lib/db';
import { createUser } from '../src/lib/users';
import { audit } from '../src/lib/audit';

async function main() {
  const phone = process.env.TEST_USER_PHONE ?? '';
  const password = process.env.TEST_USER_PASSWORD ?? '';
  if (!phone || password.length < 12) throw new Error('Set TEST_USER_PHONE and a TEST_USER_PASSWORD of 12+ characters');
  const db = await getDb();
  try {
    const u = await createUser(db, { phone, password, firstName: 'Test', lastName: 'Player', dob: '1990-01-01', role: 'player' });
    await audit(db.q, { actorId: null, action: 'admin.test_user_created', targetType: 'user', targetId: u.id });
    console.log(`Test user created: ${u.phone}`);
  } catch (e: any) {
    console.log('Test user:', e.message);
  }
  await db.close();
}
main();
