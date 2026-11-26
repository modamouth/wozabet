import type { Db, Q } from './db';
import { config } from './config';
import { applyMargin } from './odds';
import { MARKETS, isMarket } from './markets';
import { settleFixture } from './settle';
import { newBudget, type Provider, type RequestBudget } from './providers/types';
import { suspendStaleOdds } from './risk';
import { apiFootballProvider } from './providers/apiFootball';
import { mockProvider } from './providers/mock';

export function defaultProviders(): Provider[] {
  return config.apiFootballKey ? [apiFootballProvider()] : [mockProvider()];
}

/** Pull fixtures + reference odds from the provider(s), apply OUR margin, upsert, and optionally auto-settle. */
export async function syncFixtures(db: Db, providers: Provider[], dates: string[], opts: { budget?: RequestBudget } = {}) {
  const budget = opts.budget ?? newBudget(config.apiFootballMaxRequestsPerSync);
  const summary = { fixtures: 0, withOdds: 0, finishedSettled: 0, suspendedStale: 0, errors: [] as string[], requests: budget };
  for (const p of providers) {
    // the mock feed generates fixtures relative to "now", so one date is enough
    for (const date of p.name === 'mock' ? dates.slice(0, 1) : dates) {
      let list;
      try {
        list = await p.fetchFixtures(date, { budget });
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
          // suspend prices once the match has started unless live betting is switched on
          const suspended = f.status === 'scheduled' ? false : !(config.liveBetting && f.status === 'live');
          if (!f.markets && f.status !== 'scheduled' && !(config.liveBetting && f.status === 'live')) {
            await q('UPDATE odds SET suspended=true WHERE fixture_id=$1 AND NOT suspended', [f.id]);
          }
          for (const [market, source] of Object.entries(f.markets ?? {})) {
            if (!isMarket(market) || !source) continue;
            const ours = applyMargin(source, config.margin, MARKETS[market].overround);
            for (const [sel, price] of Object.entries(ours)) {
              if (!(MARKETS[market].selections as readonly string[]).includes(sel)) continue;
              await q(
                `INSERT INTO odds (fixture_id, market, selection, source_milli, price_milli, suspended, source_updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)
                 ON CONFLICT (fixture_id, market, selection) DO UPDATE SET source_milli=$4, price_milli=$5, suspended=$6, source_updated_at=$7, updated_at=now()`,
                [f.id, market, sel, Math.round(source[sel] * 1000), price, suspended, f.oddsUpdatedAt ?? new Date()],
              );
            }
          }
        });
        summary.fixtures += 1;
        if (f.markets && Object.keys(f.markets).length) summary.withOdds += 1;
        if (config.autoSettle && (f.status === 'finished' || f.status === 'cancelled')) {
          const r = await settleFixture(db, f.id);
          if (!r.alreadySettled) summary.finishedSettled += 1;
        }
      }
    }
  }
  summary.suspendedStale = await suspendStaleOdds(db);
  return summary;
}

export const todayAndTomorrow = (now = new Date()) => {
  const d = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString().slice(0, 10);
  return [d(0), d(1), d(2)];
};
