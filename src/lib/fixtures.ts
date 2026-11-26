import type { Db } from './db';
import { staleSql } from './risk';

export interface MatchDTO {
  id: string; sport: string; league: string; home: string; away: string; kickoff: string; status: string;
  homeScore: number | null; awayScore: number | null;
  odds: { market: string; selection: string; priceMilli: number; suspended: boolean }[];
}

import { MARKETS, MARKET_KEYS } from './markets';

/** Stable display order: by market, then by the market's selection order. */
const rank = (m: string, s: string) => {
  const mi = MARKET_KEYS.indexOf(m as any);
  const si = mi < 0 ? 9 : (MARKETS[m as keyof typeof MARKETS].selections as readonly string[]).indexOf(s);
  return (mi < 0 ? 99 : mi) * 10 + (si < 0 ? 9 : si);
};

export async function listMatches(db: Db, opts: { sport?: string; live?: boolean }): Promise<MatchDTO[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (opts.live) {
    where.push("f.status = 'live'");
  } else {
    where.push("f.status = 'scheduled'", 'f.kickoff > now()');
  }
  if (opts.sport) {
    params.push(opts.sport);
    where.push(`f.sport = $${params.length}`);
  }
  const rows = await db.q<any>(
    `SELECT f.*, COALESCE(json_agg(json_build_object('market', o.market, 'selection', o.selection, 'priceMilli', o.price_milli, 'suspended', o.suspended OR ${staleSql('o')}))
              FILTER (WHERE o.selection IS NOT NULL), '[]'::json) AS odds
       FROM fixtures f LEFT JOIN odds o ON o.fixture_id = f.id
      WHERE ${where.join(' AND ')} GROUP BY f.id
      ${opts.live ? '' : 'HAVING count(o.selection) > 0'} ORDER BY f.kickoff LIMIT 200`,
    params,
  );
  return rows.map((r: any) => ({
    id: r.id, sport: r.sport, league: r.league, home: r.home, away: r.away, kickoff: new Date(r.kickoff).toISOString(),
    status: r.status, homeScore: r.home_score, awayScore: r.away_score,
    odds: [...r.odds].sort((a: any, b: any) => rank(a.market, a.selection) - rank(b.market, b.selection)),
  }));
}
