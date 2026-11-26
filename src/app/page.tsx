'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, type Match } from './store';
import MatchCard from './match-card';

const SPORTS = ['Football', 'Rugby', 'Basketball'];

export default function Home() {
  const [sport, setSport] = useState('Football');
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    setMatches(null);
    api<{ matches: Match[] }>(`/api/matches?sport=${sport}`).then((r) => alive && setMatches(r.matches)).catch((e) => alive && setErr(e.message));
    const t = setInterval(() => api<{ matches: Match[] }>(`/api/matches?sport=${sport}`).then((r) => alive && setMatches(r.matches)).catch(() => {}), 30_000);
    return () => { alive = false; clearInterval(t); };
  }, [sport]);

  return (
    <>
      <div className="chips">
        {SPORTS.map((s) => <button key={s} className={'chip' + (s === sport ? ' on' : '')} onClick={() => setSport(s)}>{s}</button>)}
      </div>
      <div className="banner">
        <div><h3>Welcome bonus</h3><p>Up to N$20,000 on your first deposit</p></div>
        <Link href="/join" className="btn">Claim</Link>
      </div>
      {err && <div className="empty">{err}</div>}
      {matches === null && !err && <div className="empty">Loading matches…</div>}
      {matches?.length === 0 && <div className="empty">No upcoming {sport.toLowerCase()} matches right now.</div>}
      {matches?.map((m) => <MatchCard key={m.id} m={m} />)}
      <div className="note">Odds change often. 18+ · Gamble responsibly.</div>
    </>
  );
}
