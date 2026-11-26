'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, useApp } from '../store';

interface Fx { id: string; league: string; home: string; away: string; kickoff: string; status: string; homeScore: number | null; awayScore: number | null; openLegs: number }

export default function Admin() {
  const { me } = useApp();
  const [list, setList] = useState<Fx[] | null>(null);
  const [score, setScore] = useState<Record<string, { h: string; a: string }>>({});
  const [msg, setMsg] = useState('');
  const load = useCallback(() => api<{ fixtures: Fx[] }>('/api/admin/fixtures').then((r) => setList(r.fixtures)).catch((e) => setMsg(e.message)), []);
  useEffect(() => { if (me?.user?.role === 'admin') void load(); }, [me, load]);
  if (!me?.user || me.user.role !== 'admin') return <div className="empty">Admins only.</div>;

  const settle = async (f: Fx, cancel = false) => {
    const s = score[f.id] ?? { h: String(f.homeScore ?? ''), a: String(f.awayScore ?? '') };
    try {
      const r = await api<{ bets: number; alreadySettled: boolean }>('/api/admin/settle', { json: cancel ? { fixtureId: f.id, cancel: true } : { fixtureId: f.id, homeScore: Number(s.h), awayScore: Number(s.a) } });
      setMsg(r.alreadySettled ? 'Already settled' : `Settled. ${r.bets} bet(s) resolved.`); await load();
    } catch (e) { setMsg((e as Error).message); }
  };
  const sync = async () => { try { const r = await api('/api/cron/sync', { method: 'POST' }); setMsg('Synced: ' + JSON.stringify(r)); await load(); } catch (e) { setMsg((e as Error).message); } };

  return (
    <>
      <h2 className="title">Results &amp; settlement</h2>
      <div style={{ padding: '8px 16px' }}><button className="btn ghost" onClick={sync}>Sync odds &amp; fixtures now</button></div>
      {msg && <div className="warn" style={{ margin: '8px 16px' }}>{msg}</div>}
      {list?.length === 0 && <div className="empty">Nothing to settle.</div>}
      {list?.map((f) => (
        <div className="card" key={f.id}>
          <div className="muted" style={{ fontSize: 12 }}>{f.league} · {new Date(f.kickoff).toLocaleString('en-GB')} · {f.status} · {f.openLegs} open leg(s)</div>
          <div style={{ fontWeight: 600, margin: '6px 0 10px' }}>{f.home} vs {f.away}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input aria-label={`${f.home} score`} inputMode="numeric" style={{ width: 64, height: 44, borderRadius: 8, border: '1px solid #444', background: 'var(--bg)', color: '#fff', textAlign: 'center', fontSize: 16 }}
              value={score[f.id]?.h ?? (f.homeScore ?? '')} onChange={(e) => setScore({ ...score, [f.id]: { h: e.target.value, a: score[f.id]?.a ?? String(f.awayScore ?? '') } })} />
            <span>–</span>
            <input aria-label={`${f.away} score`} inputMode="numeric" style={{ width: 64, height: 44, borderRadius: 8, border: '1px solid #444', background: 'var(--bg)', color: '#fff', textAlign: 'center', fontSize: 16 }}
              value={score[f.id]?.a ?? (f.awayScore ?? '')} onChange={(e) => setScore({ ...score, [f.id]: { a: e.target.value, h: score[f.id]?.h ?? String(f.homeScore ?? '') } })} />
            <button className="btn" onClick={() => settle(f)}>Settle</button>
            <button className="btn danger" onClick={() => confirm('Cancel this match and refund all stakes?') && settle(f, true)}>Void</button>
          </div>
        </div>
      ))}
    </>
  );
}
