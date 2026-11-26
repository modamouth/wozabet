'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ApiError, api, useApp } from './store';
import { formatNad, formatOdds } from '@/lib/money';
import { potentialReturnCents, totalOddsMilli } from '@/lib/odds';

export default function BetSlip() {
  const { me, picks, remove, clear, applyPrices, slipOpen, setSlipOpen, refreshMe } = useApp();
  const [stake, setStake] = useState('50');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [placed, setPlaced] = useState<number | null>(null);
  if (!slipOpen) return null;

  const list = Object.values(picks);
  const stakeCents = Math.round((parseFloat(stake.replace(',', '.')) || 0) * 100);
  const total = totalOddsMilli(list.map((p) => p.priceMilli));
  const ret = potentialReturnCents(stakeCents, total);
  const close = () => { setSlipOpen(false); setPlaced(null); setNotice(''); setError(''); };

  async function place() {
    setBusy(true); setError(''); setNotice('');
    try {
      const r = await api<{ bet: { potentialReturnCents: number } }>('/api/bets', {
        json: { stakeCents, selections: list.map((p) => ({ fixtureId: p.fixtureId, selection: p.selection, priceMilli: p.priceMilli })) },
      });
      setPlaced(r.bet.potentialReturnCents);
      clear();
      void refreshMe();
    } catch (e) {
      const err = e as ApiError;
      if (err.code === 'price_changed') { applyPrices(err.data.changed); setNotice('Odds have changed. Review the new odds, then tap Place bet again.'); }
      else if (err.code === 'unavailable') { (err.data.unavailable as string[]).forEach(remove); setNotice('Some selections are no longer available and were removed.'); }
      else if (err.code === 'unauthorized') setError('Please log in to place a bet.');
      else setError(err.message);
    } finally { setBusy(false); }
  }

  return (
    <>
      <button className="scrim" aria-label="Close bet slip" onClick={close} />
      <div className="sheet" role="dialog" aria-label="Bet slip">
        {placed !== null ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <h2 style={{ fontSize: 20 }}>Bet placed</h2>
            <p className="muted" style={{ fontSize: 13, margin: '6px 0 18px' }}>Potential return {formatNad(placed)}</p>
            <Link href="/bets" onClick={close} className="btn block">View in My bets</Link>
          </div>
        ) : (
          <>
            <div className="row" style={{ alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ fontSize: 18 }}>Bet slip <span className="green">({list.length})</span></h2>
              <button onClick={clear} style={{ height: 44, background: 'transparent', border: 0, color: 'var(--muted)', fontSize: 13 }}>Clear all</button>
            </div>
            {list.length === 0 && <p className="muted" style={{ textAlign: 'center', padding: '24px 0', fontSize: 14 }}>Tap any odds to add a selection.</p>}
            {list.map((p) => (
              <div className="sel" key={p.fixtureId}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{p.pickName}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{p.game}</div>
                </div>
                <strong className="green">{formatOdds(p.priceMilli)}</strong>
                <button className="x" aria-label="Remove selection" onClick={() => remove(p.fixtureId)}>×</button>
              </div>
            ))}
            {list.length > 0 && (
              <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 4 }}>
                {notice && <div className="warn">{notice}</div>}
                <label htmlFor="stake" className="muted" style={{ fontSize: 12 }}>Stake (N$)</label>
                <input id="stake" inputMode="decimal" value={stake} onChange={(e) => setStake(e.target.value)}
                  style={{ display: 'block', width: '100%', height: 48, marginTop: 6, padding: '0 14px', borderRadius: 10, border: '1px solid #444', background: 'var(--bg)', color: '#fff', fontSize: 18, fontWeight: 600 }} />
                <div className="quick">{[10, 50, 100, 200].map((v) => <button key={v} onClick={() => setStake(String(v))}>N$ {v}</button>)}</div>
                <div className="row muted" style={{ marginTop: 16 }}><span>Total odds</span><strong style={{ color: '#fff' }}>{formatOdds(total)}</strong></div>
                <div className="row muted" style={{ marginTop: 6 }}><span>Potential return</span><strong className="green" style={{ fontSize: 16 }}>{formatNad(ret)}</strong></div>
                {error && <div className="err">{error}{error.includes('log in') && <> <Link href="/login" onClick={close} className="green">Log in</Link></>}</div>}
                {me && !me.user
                  ? <Link href="/login" onClick={close} className="btn block" style={{ marginTop: 16 }}>Log in to bet</Link>
                  : <button className="btn block" style={{ marginTop: 16 }} disabled={busy || stakeCents < (me?.minStakeCents ?? 100)} onClick={place}>{busy ? 'Placing…' : 'Place bet'}</button>}
                <p className="muted" style={{ fontSize: 11, textAlign: 'center', margin: '10px 0 0' }}>18+ · Gamble responsibly</p>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
