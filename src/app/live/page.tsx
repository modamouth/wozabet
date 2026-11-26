'use client';
import { useEffect, useState } from 'react';
import { api, useApp, type Match } from '../store';
import MatchCard from '../match-card';

export default function Live() {
  const { me } = useApp();
  const [matches, setMatches] = useState<Match[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => api<{ matches: Match[] }>('/api/matches?live=1').then((r) => alive && setMatches(r.matches)).catch(() => {});
    void load();
    const t = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 16px 4px' }}>
        <span className="livebadge" style={{ fontSize: 12 }}>LIVE</span><h2 style={{ fontSize: 18 }}>In-play now</h2>
      </div>
      {me && !me.liveBetting && <div className="note" style={{ textAlign: 'left' }}>Live scores only. In-play betting is switched off.</div>}
      {matches === null && <div className="empty">Loading…</div>}
      {matches?.length === 0 && <div className="empty">No matches in play right now.</div>}
      {matches?.map((m) => <MatchCard key={m.id} m={m} />)}
    </>
  );
}
