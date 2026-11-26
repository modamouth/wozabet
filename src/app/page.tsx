'use client';
import { useEffect, useState } from 'react';
import { api, type Match } from './store';
import MatchCard from './match-card';

/** Football only for now: rugby/basketball come back once a real data source is contracted. */
export default function Home() {
  const sport = 'Football';
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    setMatches(null);
    api<{ matches: Match[] }>(`/api/matches?sport=${sport}`).then((r) => alive && setMatches(r.matches)).catch((e) => alive && setErr(e.message));
    const t = setInterval(() => api<{ matches: Match[] }>(`/api/matches?sport=${sport}`).then((r) => alive && setMatches(r.matches)).catch(() => {}), 30_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <>
      <div className="banner">
        <div><h3>Football betting for Namibia</h3><p>Match result, double chance, over/under 2.5 and both teams to score.</p></div>
      </div>
      {err && <div className="empty">{err}</div>}
      {matches === null && !err && <div className="empty">Loading matches…</div>}
      {matches?.length === 0 && <div className="empty">No upcoming matches right now.</div>}
      {matches?.map((m) => <MatchCard key={m.id} m={m} />)}
      <div className="note">Odds change often. 18+ · Gamble responsibly.</div>
    </>
  );
}
