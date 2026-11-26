'use client';
import { useEffect, useState } from 'react';
import { api, type Match } from './store';
import MatchCard from './match-card';
import { AppBanner, Hero, PaymentMethods, Promotions, TopCompetitions } from './landing';

/** Football only for now: rugby/basketball come back once a real data source is contracted. */
export default function Home() {
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [err, setErr] = useState('');
  const [league, setLeague] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => api<{ matches: Match[] }>('/api/matches?sport=Football').then((r) => alive && setMatches(r.matches));
    load().catch((e) => alive && setErr(e.message));
    const t = setInterval(() => load().catch(() => {}), 30_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const shown = (matches ?? []).filter((m) => !league || m.league === league);

  return (
    <>
      <div className="desk"><Hero /></div>
      <div className="banner mob">
        <div><h3>Football betting for Namibia</h3><p>Match result, double chance, over/under 2.5 and both teams to score.</p></div>
      </div>
      <div className="home-grid">
        <div className="home-main" id="matches">
          <div className="desk"><TopCompetitions matches={matches ?? []} league={league} setLeague={setLeague} /></div>
          <h2 className="title desk-title">{league ?? 'Upcoming matches'}</h2>
          {err && <div className="empty">{err}</div>}
          {matches === null && !err && <div className="empty">Loading matches…</div>}
          {matches?.length === 0 && <div className="empty">No upcoming matches right now. Check back soon.</div>}
          <div className="match-list">{shown.map((m) => <MatchCard key={m.id} m={m} />)}</div>
          <div className="note">Odds change often. 18+ · Gamble responsibly.</div>
        </div>
        <aside className="home-side desk" aria-label="More from Wozabet">
          <Promotions />
          <PaymentMethods />
        </aside>
      </div>
      <div className="desk"><AppBanner /></div>
    </>
  );
}
