import { handle, ok } from '@/lib/http';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Fixtures that have started (or finished) but are not settled yet, with the number of open bet legs on each. */
export async function GET() {
  return handle(async () => {
    await requireAdmin();
    const rows = await (await getDb()).q<any>(
      `SELECT f.id, f.league, f.home, f.away, f.kickoff, f.status, f.home_score, f.away_score,
              (SELECT count(*)::int FROM bet_legs l WHERE l.fixture_id = f.id AND l.status = 'open') AS open_legs
         FROM fixtures f WHERE f.settled = false AND (f.kickoff < now() OR f.status <> 'scheduled')
        ORDER BY f.kickoff DESC LIMIT 100`,
    );
    return ok({ fixtures: rows.map((r: any) => ({ id: r.id, league: r.league, home: r.home, away: r.away, kickoff: r.kickoff, status: r.status, homeScore: r.home_score, awayScore: r.away_score, openLegs: r.open_legs })) });
  });
}
