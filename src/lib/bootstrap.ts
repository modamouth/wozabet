import { getDb } from './db';
import { config } from './config';
import { defaultProviders, syncFixtures, todayAndTomorrow } from './sync';

let running: Promise<void> | null = null;

/** In mock mode, (re)generate sample fixtures whenever there is nothing upcoming, so the app is never empty in dev. */
export function ensureData(): Promise<void> {
  if (config.apiFootballKey || !config.mockFeed) return Promise.resolve(); // real data comes from the cron sync; no fake data in production
  running ??= (async () => {
    try {
      const db = await getDb();
      const n = await db.q<{ c: number; fresh: boolean }>(
        `SELECT (SELECT count(*)::int FROM fixtures WHERE status='scheduled' AND kickoff > now()) AS c,
                COALESCE((SELECT max(updated_at) FROM odds) > now() - make_interval(mins => $1), false) AS fresh`,
        [Math.max(1, Math.floor(config.oddsMaxAgeMinutes / 2))]);
      // the mock "feed" is local and free, so refresh it before its prices go stale
      if (n[0].c === 0 || !n[0].fresh) await syncFixtures(db, defaultProviders(), todayAndTomorrow());
    } finally {
      running = null;
    }
  })();
  return running;
}
