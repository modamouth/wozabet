import { getDb } from '../src/lib/db';
import { createUser } from '../src/lib/users';
import { defaultProviders, syncFixtures, todayAndTomorrow } from '../src/lib/sync';

async function main() {
  const db = await getDb();
  const phone = process.env.ADMIN_PHONE || '0811111111';
  const password = process.env.ADMIN_PASSWORD || 'change-me-admin';
  try {
    await createUser(db, { phone, password, firstName: 'Admin', lastName: 'Wozabet', dob: '1990-01-01', role: 'admin' });
    console.log(`Admin created: ${phone}`);
  } catch (e: any) {
    console.log('Admin:', e.message);
  }
  console.log('Sync:', await syncFixtures(db, defaultProviders(), todayAndTomorrow()));
  await db.close();
}
main();
