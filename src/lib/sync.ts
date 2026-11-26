import type { Db, Q } from './db';
import { config } from './config';
import { applyMargin } from './odds';
import { settleFixture } from './settle';
import type { Provider } from './providers/types';
import { apiFootballProvider } from './providers/apiFootball';
import { mockProvider } from './providers/mock';

export function defaultProviders(): Provider[] {
  return config.apiFootballKey ? [apiFootballProvider()] : [mockProvider()];
}

/** Pull fixtures + reference odds from the provider(s), apply OUR margin, upsert, and optionally auto-settle. */
export async function syncFixtures(db: Db, providers: Provider[], dates: string[]) {
  const summary = { fixtures: 0, finishedSettled: 0, errors: [] as string[] };
  for (const p of providers) {
    // the mock feed generates fixtures relative to "now", so one date is enough
    for (const date of p.name === 'mock' ? dates.slice(0, 1) : dates) {
      let list;
      try {
        list = await p.fetchFixtures(date);
      } catch (e) {
        summary.errors.push(`${p.name} ${date}: ${(e as Error).message}`);
        continue;
      }
      for (const f of list) {
        await db.tx(async (q: Q) => {
          const prev = (await q<any>('SELECT status, settled FROM fixtures WHERE id=$1', [f.id]))[0];
          if (prev?.settled) return; // never touch a fixture that is already settled
          await q(
            `INSERT INTO fixtures (id, sport, league, home, away, kickoff, status, home_score, away_score)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (id) DO UPDATE SET league=$3, home=$4, away=$5, kickoff=$6, status=$7, home_score=$8, away_score=$9, updated_at=now()`,
            [f.id, f.sport, f.league, f.home, f.away, f.kickoff, f.status, f.homeScore, f.awayScore],
          );
          if (f.odds) {
            const ours = applyMargin(f.odds, config.margin);
            // suspend prices once the match has started unless live betting is switched on
            const suspended = f.status === 'scheduled' ? false : !(config.liveBetting && f.status === 'live');
            for (const [sel, price] of Object.entries(ours)) {
              await q(
                `INSERT INTO odds (fixture_id, selection, source_milli, price_milli, suspended)
                 VALUES ($1,$2,$3,$4,$5)
                 ON CONFLICT (fixture_id, selection) DO UPDATE SET source_milli=$3, price_milli=$4, suspended=$5, updated_at=now()`,
                [f.id, sel, Math.round(f.odds[sel] * 1000), price, suspended],
              );
            }
          }
        });
        summary.fixtures += 1;
        if (config.autoSettle && (f.status === 'finished' || f.status === 'cancelled')) {
          const r = await settleFixture(db, f.id);
          if (!r.alreadySettled) summary.finishedSettled += 1;
        }
      }
    }
  }
  return summary;
}

export const todayAndTomorrow = (now = new Date()) => {
  const d = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString().slice(0, 10);
  return [d(0), d(1), d(2)];
};
