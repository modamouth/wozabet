'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, useApp } from '../store';
import { formatNad, formatOdds } from '@/lib/money';

interface Leg { selection: string; priceMilli: number; status: string; home: string; away: string }
interface Bet { id: string; kind: string; status: string; stakeCents: number; totalOddsMilli: number; potentialReturnCents: number; returnCents: number | null; placedAt: string; legs: Leg[] }

const sel = (l: Leg) => (l.selection === '1' ? l.home : l.selection === '2' ? l.away : 'Draw') + ` (${l.selection})`;

export default function Bets() {
  const { me } = useApp();
  const [bets, setBets] = useState<Bet[] | null>(null);
  const [tab, setTab] = useState<'open' | 'settled'>('open');
  useEffect(() => {
    if (me && !me.user) { setBets([]); return; }
    if (me?.user) api<{ bets: Bet[] }>('/api/bets').then((r) => setBets(r.bets)).catch(() => setBets([]));
  }, [me]);
  const shown = (bets ?? []).filter((b) => (tab === 'open' ? b.status === 'open' : b.status !== 'open'));
  return (
    <>
      <h2 className="title">My bets</h2>
      <div className="chips">
        <button className={'chip' + (tab === 'open' ? ' on' : '')} onClick={() => setTab('open')}>Open</button>
        <button className={'chip' + (tab === 'settled' ? ' on' : '')} onClick={() => setTab('settled')}>Settled</button>
      </div>
      {me && !me.user && <div className="empty">Log in to see your bets.<br /><br /><Link href="/login" className="btn">Log in</Link></div>}
      {me?.user && bets && shown.length === 0 && <div className="empty">No {tab} bets.</div>}
      <div style={{ marginTop: 8 }}>
        {shown.map((b) => (
          <div className="card" key={b.id}>
            <div className="row muted" style={{ fontSize: 12 }}>
              <span>{b.kind === 'single' ? 'Single' : `Accumulator · ${b.legs.length}`} · {new Date(b.placedAt).toLocaleDateString('en-GB')}</span>
              <span className={b.status === 'won' ? 'green' : ''} style={{ fontWeight: 600, textTransform: 'capitalize' }}>{b.status}</span>
            </div>
            {b.legs.map((l, i) => (
              <div className="row" style={{ marginTop: 10 }} key={i}>
                <span><strong>{sel(l)}</strong><br /><span className="muted" style={{ fontSize: 12 }}>{l.home} vs {l.away} · {l.status}</span></span>
                <strong>{formatOdds(l.priceMilli)}</strong>
              </div>
            ))}
            <div className="row" style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line)', fontSize: 13 }}>
              <span className="muted">Stake {formatNad(b.stakeCents)} · Odds {formatOdds(b.totalOddsMilli)}</span>
              <strong className="green">{b.status === 'open' ? `Return ${formatNad(b.potentialReturnCents)}` : b.status === 'lost' ? 'Lost' : `Paid ${formatNad(b.returnCents ?? 0)}`}</strong>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
