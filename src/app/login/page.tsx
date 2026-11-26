'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, useApp } from '../store';

export default function Login() {
  const { refreshMe } = useApp();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api('/api/auth/login', { json: { phone, password } }); await refreshMe(); location.href = '/'; }
    catch (x) { setErr((x as Error).message); setBusy(false); }
  }
  return (
    <>
      <div className="tabs"><Link href="/join">Join</Link><Link href="/login" className="on">Log in</Link></div>
      <form className="form" onSubmit={submit}>
        <h2 style={{ fontSize: 22 }}>Welcome back</h2>
        <label htmlFor="p">Mobile number</label>
        <input id="p" type="tel" inputMode="tel" autoComplete="tel" placeholder="081 234 5678" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <label htmlFor="w">Password</label>
        <input id="w" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {err && <div className="err" role="alert">{err}</div>}
        <button className="btn block" style={{ marginTop: 20 }} disabled={busy || !phone || !password}>{busy ? 'Logging in…' : 'Log in'}</button>
      </form>
    </>
  );
}
