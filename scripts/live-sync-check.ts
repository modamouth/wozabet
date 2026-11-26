/** One-off: real API-Football sync into a throwaway in-memory DB (uses up to 4 requests). */
import { createPgliteDb } from '../src/lib/db';
import { apiFootballProvider } from '../src/lib/providers/apiFootball';
import { newBudget } from '../src/lib/providers/types';
import { syncFixtures } from '../src/lib/sync';
import { listMatches } from '../src/lib/fixtures';

async function main() {
  const db = await createPgliteDb();
  const leagues = (process.argv[2] ?? '3').split(',');
  const r = await syncFixtures(db, [apiFootballProvider({ leagues })], [new Date().toISOString().slice(0, 10)], { budget: newBudget(4) });
  console.log('summary:', JSON.stringify({ ...r, requests: r.requests }));
  const m = await listMatches(db, {});
  for (const x of m.slice(0, 8)) console.log(`${x.league} | ${x.home} v ${x.away} | ${x.kickoff} | ${x.odds.map((o) => `${o.selection}:${(o.priceMilli / 1000).toFixed(2)}${o.suspended ? '(s)' : ''}`).join(' ')}`);
  const live = await listMatches(db, { live: true });
  console.log(`live now: ${live.length}`);
  await db.close();
}
main();
