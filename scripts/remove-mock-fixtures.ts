/**
 * Remove fake (mock-*) fixtures from a database, e.g. production after the mock feed ran there.
 * Only deletes fixtures no bet references. Writes an audit entry. Usage: DATABASE_URL=... npx tsx scripts/remove-mock-fixtures.ts [--dry-run]
 */
import { getDb } from '../src/lib/db';
import { audit } from '../src/lib/audit';

async function main() {
  const dry = process.argv.includes('--dry-run');
  const db = await getDb();
  const rows = await db.q<{ id: string; home: string; away: string; used: boolean }>(
    `SELECT f.id, f.home, f.away, EXISTS (SELECT 1 FROM bet_legs l WHERE l.fixture_id = f.id) AS used FROM fixtures f WHERE f.id LIKE 'mock-%' ORDER BY f.id`);
  console.log(`mock fixtures: ${rows.length} (${rows.filter((r) => r.used).length} referenced by bets, kept)`);
  for (const r of rows) console.log(`  ${r.id} ${r.home} v ${r.away}${r.used ? '  [has bets: kept]' : ''}`);
  if (!dry) {
    const ids = rows.filter((r) => !r.used).map((r) => r.id);
    await db.tx(async (q) => {
      if (ids.length) await q('DELETE FROM fixtures WHERE id = ANY($1::text[])', [ids]); // odds cascade
      await audit(q, { actorId: null, action: 'admin.remove_mock_fixtures', details: { removed: ids.length, ids } });
    });
    console.log(`removed ${ids.length}`);
  }
  await db.close();
}
main();
