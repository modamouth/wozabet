'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, useApp } from '../store';
import { formatNad } from '@/lib/money';

export default function Me() {
  const { me, refreshMe } = useApp();
  const [msg, setMsg] = useState('');
  if (!me) return <div className="empty">Loading…</div>;
  if (!me.user) return <div className="empty">You are not logged in.<br /><br /><Link href="/login" className="btn">Log in</Link></div>;
  const u = me.user;
  const topUp = async (n: number) => {
    try { await api('/api/wallet/demo-deposit', { json: { amountCents: n * 100 } }); await refreshMe(); setMsg(`Added N$ ${n} (demo money)`); }
    catch (e) { setMsg((e as Error).message); }
  };
  const logout = async () => { await api('/api/auth/logout', { method: 'POST' }); await refreshMe(); location.href = '/'; };
  return (
    <>
      <h2 className="title">Account</h2>
      <div className="card" style={{ margin: '12px 16px' }}>
        <div className="muted" style={{ fontSize: 12 }}>{u.firstName} {u.lastName} · {u.phone}</div>
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Balance</div>
        <div style={{ fontFamily: '"Space Grotesk",sans-serif', fontWeight: 700, fontSize: 30 }}>{formatNad(u.balanceCents)}</div>
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Verification: {u.kycStatus}</div>
        {me.demoMode ? (
          <>
            <div className="quick">{[100, 500, 1000].map((n) => <button key={n} onClick={() => topUp(n)}>+ N$ {n}</button>)}</div>
            <p className="muted" style={{ fontSize: 11, margin: '8px 0 0' }}>Demo mode: play money only. Real deposits need the payment integration.</p>
          </>
        ) : <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>Deposits and withdrawals are coming soon.</p>}
        {msg && <p className="green" style={{ fontSize: 13 }}>{msg}</p>}
      </div>
      <div className="menu" style={{ margin: '0 16px', borderTop: '1px solid var(--line)' }}>
        {u.role === 'admin' && <Link href="/admin">Admin: results &amp; settlement <span className="muted">›</span></Link>}
        <button onClick={logout}>Log out <span className="muted">›</span></button>
      </div>
      <div className="note">18+ · Gamble responsibly · Licensed in Namibia</div>
    </>
  );
}
