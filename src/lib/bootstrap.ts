import { getDb } from './db';
import { config } from './config';
import { defaultProviders, syncFixtures, todayAndTomorrow } from './sync';

let running: Promise<void> | null = null;

/** In mock mode, (re)generate sample fixtures whenever there is nothing upcoming, so the app is never empty in dev. */
export function ensureData(): Promise<void> {
  if (config.apiFootballKey) return Promise.resolve(); // real data comes from the cron sync
  running ??= (async () => {
    try {
      const db = await getDb();
      const n = await db.q<{ c: number }>("SELECT count(*)::int AS c FROM fixtures WHERE status='scheduled' AND kickoff > now()");
      if (n[0].c === 0) await syncFixtures(db, defaultProviders(), todayAndTomorrow());
    } finally {
      running = null;
    }
  })();
  return running;
}
