'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, useApp } from '../../store';
import { formatNad, parseNadToCents } from '@/lib/money';

type Period = 'day' | 'week' | 'month';
type Kind = 'deposit' | 'loss';
interface LimitState { amountCents: number | null; usedCents: number; pending: { amountCents: number | null; effectiveFrom: string } | null }
interface Overview { limits: Record<Kind, Record<Period, LimitState>>; sessionReminderMinutes: number | null }

const LABEL: Record<Period, string> = { day: 'Daily (24 hours)', week: 'Weekly (7 days)', month: 'Monthly (30 days)' };
const inputStyle = { flex: 1, minWidth: 0, height: 44, borderRadius: 8, border: '1px solid #444', background: 'var(--bg)', color: '#fff', padding: '0 12px', fontSize: 16 } as const;

function LimitRow({ kind, period, st, onSaved }: { kind: Kind; period: Period; st: LimitState; onSaved: (m: string) => void }) {
  const [v, setV] = useState('');
  const save = async (cents: number | null) => {
    try {
      const r = await api<{ delayed: boolean; effectiveFrom: string }>('/api/rg/limits', { json: { kind, period, amountCents: cents } });
      onSaved(r.delayed ? `Saved. Because this raises or removes a limit, it applies from ${new Date(r.effectiveFrom).toLocaleString('en-GB')}.` : 'Saved. Your new limit applies now.');
      setV('');
    } catch (e) { onSaved((e as Error).message); }
  };
  return (
    <div style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
      <div className="row"><span>{LABEL[period]}</span><b>{st.amountCents === null ? 'No limit' : formatNad(st.amountCents)}</b></div>
      <div className="muted" style={{ fontSize: 12 }}>{kind === 'deposit' ? 'Deposited' : 'Net loss'} in this period: {formatNad(Math.max(0, st.usedCents))}</div>
      {st.pending && <div className="muted" style={{ fontSize: 12 }}>Changing to {st.pending.amountCents === null ? 'no limit' : formatNad(st.pending.amountCents)} on {new Date(st.pending.effectiveFrom).toLocaleString('en-GB')}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input aria-label={`${LABEL[period]} ${kind} limit in N$`} inputMode="decimal" placeholder="New limit, N$" value={v} onChange={(e) => setV(e.target.value)} style={inputStyle} />
        <button className="btn" onClick={() => { const c = parseNadToCents(v); if (c === null || c <= 0) onSaved('Enter an amount like 500'); else void save(c); }}>Set</button>
        {st.amountCents !== null && <button className="btn ghost" onClick={() => save(null)}>Remove</button>}
      </div>
    </div>
  );
}

export default function Limits() {
  const { me } = useApp();
  const [ov, setOv] = useState<Overview | null>(null);
  const [msg, setMsg] = useState('');
  const load = useCallback(() => api<Overview>('/api/rg').then(setOv).catch((e) => setMsg(e.message)), []);
  useEffect(() => { if (me?.user) void load(); }, [me, load]);
  if (!me?.user) return <div className="empty">Please <Link href="/login" className="green">log in</Link>.</div>;
  if (!ov) return <div className="empty">Loading…</div>;
  const saved = (m: string) => { setMsg(m); void load(); };
  const setReminder = async (minutes: number | null) => { try { await api('/api/rg/reminder', { json: { minutes } }); saved(minutes ? `We'll remind you every ${minutes} minutes.` : 'Session reminders off.'); } catch (e) { setMsg((e as Error).message); } };

  return (
    <>
      <h2 className="title">Limits &amp; reminders</h2>
      <p className="muted" style={{ fontSize: 13, padding: '0 16px' }}>Lower limits apply straight away. Higher limits, or removing a limit, apply after 24 hours.</p>
      {msg && <div className="warn" style={{ margin: '8px 16px' }} role="status">{msg}</div>}
      <div className="card"><div style={{ fontWeight: 600 }}>Deposit limits</div>
        {(['day', 'week', 'month'] as const).map((p) => <LimitRow key={p} kind="deposit" period={p} st={ov.limits.deposit[p]} onSaved={saved} />)}
      </div>
      <div className="card"><div style={{ fontWeight: 600 }}>Loss limits</div>
        <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>Net loss = stakes minus winnings. Open bets count as lost until they settle.</p>
        {(['day', 'week', 'month'] as const).map((p) => <LimitRow key={p} kind="loss" period={p} st={ov.limits.loss[p]} onSaved={saved} />)}
      </div>
      <div className="card"><div style={{ fontWeight: 600, marginBottom: 8 }}>Session time reminder</div>
        <div className="chips" style={{ padding: 0, flexWrap: 'wrap' }}>
          {[null, 15, 30, 60, 120].map((m) => <button key={String(m)} className={ov.sessionReminderMinutes === m ? 'chip on' : 'chip'} aria-pressed={ov.sessionReminderMinutes === m} onClick={() => setReminder(m)}>{m ? `${m} min` : 'Off'}</button>)}
        </div>
      </div>
      <div className="note"><Link href="/me/break" className="green">Take a break or self-exclude ›</Link> · <Link href="/responsible-gambling">Get help</Link></div>
    </>
  );
}
