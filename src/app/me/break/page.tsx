'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, useApp } from '../../store';

interface Overview { coolOffUntil: string | null; selfExcludedUntil: string | null; selfExcludedPermanent: boolean }

export default function Break() {
  const { me, refreshMe } = useApp();
  const [ov, setOv] = useState<Overview | null>(null);
  const [msg, setMsg] = useState('');
  const load = useCallback(() => api<Overview>('/api/rg').then(setOv).catch((e) => setMsg(e.message)), []);
  useEffect(() => { if (me?.user) void load(); }, [me, load]);
  if (!me?.user) return <div className="empty">Please <Link href="/login" className="green">log in</Link>.</div>;
  if (!ov) return <div className="empty">Loading…</div>;

  const coolOff = async (option: '24h' | '7d' | '30d', label: string) => {
    if (!confirm(`Take a ${label} break? You won't be able to bet or deposit until it ends, and it can't be cancelled early. You can still log in and withdraw.`)) return;
    try { await api('/api/rg/cool-off', { json: { option, confirm: true } }); setMsg(`Your ${label} break has started.`); await Promise.all([load(), refreshMe()]); } catch (e) { setMsg((e as Error).message); }
  };
  const exclude = async (option: '1m' | '6m' | 'permanent', label: string) => {
    const warn = option === 'permanent'
      ? 'PERMANENTLY self-exclude? You will never be able to bet or deposit with Wozabet again. This cannot be undone.'
      : `Self-exclude for ${label}? You won't be able to bet or deposit until it ends. It cannot be shortened or cancelled.`;
    if (!confirm(warn)) return;
    if (option === 'permanent' && prompt('Type EXCLUDE to confirm') !== 'EXCLUDE') return;
    try { await api('/api/rg/self-exclude', { json: { option, confirm: true } }); setMsg('Self-exclusion is active. You can still log in to withdraw your balance.'); await Promise.all([load(), refreshMe()]); } catch (e) { setMsg((e as Error).message); }
  };

  return (
    <>
      <h2 className="title">Take a break</h2>
      {msg && <div className="warn" style={{ margin: '8px 16px' }} role="status">{msg}</div>}
      {(ov.selfExcludedPermanent || ov.selfExcludedUntil) && (
        <div className="card"><b>Self-excluded</b> {ov.selfExcludedPermanent ? 'permanently' : `until ${new Date(ov.selfExcludedUntil!).toLocaleDateString('en-GB')}`}. Betting and deposits are blocked.</div>
      )}
      {ov.coolOffUntil && <div className="card"><b>On a break</b> until {new Date(ov.coolOffUntil).toLocaleString('en-GB')}.</div>}
      <div className="card">
        <div style={{ fontWeight: 600 }}>Cool-off</div>
        <p className="muted" style={{ fontSize: 13 }}>A short break from betting and deposits.</p>
        <div className="quick">
          <button onClick={() => coolOff('24h', '24-hour')}>24 hours</button>
          <button onClick={() => coolOff('7d', '7-day')}>7 days</button>
          <button onClick={() => coolOff('30d', '30-day')}>30 days</button>
        </div>
      </div>
      <div className="card">
        <div style={{ fontWeight: 600 }}>Self-exclusion</div>
        <p className="muted" style={{ fontSize: 13 }}>For when you need a longer break. You can still log in to withdraw your balance.</p>
        <div className="quick">
          <button onClick={() => exclude('1m', '1 month')}>1 month</button>
          <button onClick={() => exclude('6m', '6 months')}>6 months</button>
          <button onClick={() => exclude('permanent', 'permanently')} style={{ borderColor: 'var(--red)' }}>Permanent</button>
        </div>
      </div>
      <div className="note"><Link href="/responsible-gambling" className="green">Talk to someone: support and helplines ›</Link></div>
    </>
  );
}
