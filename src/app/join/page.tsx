'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, useApp } from '../store';

function ageFrom(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const t = new Date();
  let a = t.getFullYear() - +m[1];
  if (t.getMonth() + 1 < +m[2] || (t.getMonth() + 1 === +m[2] && t.getDate() < +m[3])) a -= 1;
  return a;
}

export default function Join() {
  const { refreshMe } = useApp();
  const [step, setStep] = useState(1);
  const [f, setF] = useState({ phone: '', password: '', firstName: '', lastName: '', dob: '', a18: false, tc: false, otp: '' });
  const [info, setInfo] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  // DD/MM/YYYY typed by the user -> YYYY-MM-DD for the API
  const dm = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(f.dob);
  const iso = dm ? `${dm[3]}-${dm[2]}-${dm[1]}` : '';
  const age = iso ? ageFrom(iso) : null;
  const ok = step === 1 ? f.phone.replace(/\D/g, '').length >= 8 && f.password.length >= 8
    : step === 2 ? !!(f.firstName.trim() && f.lastName.trim() && age !== null && age >= 18)
    : step === 3 ? f.a18 && f.tc : /^\d{6}$/.test(f.otp);

  async function sendCode() {
    setBusy(true); setErr(''); setInfo('');
    try { await api('/api/auth/otp', { json: { phone: f.phone } }); setInfo(`We sent a 6-digit code to ${f.phone}.`); setStep(4); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }
  async function next() {
    if (step < 3) { setStep(step + 1); return; }
    if (step === 3) { await sendCode(); return; }
    setBusy(true); setErr('');
    try {
      await api('/api/auth/register', { json: { phone: f.phone, password: f.password, firstName: f.firstName, lastName: f.lastName, dob: iso, accept18: f.a18, acceptTerms: f.tc, otpCode: f.otp } });
      await refreshMe(); location.href = '/me';
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }
  return (
    <>
      <div className="tabs"><Link href="/join" className="on">Join</Link><Link href="/login">Log in</Link></div>
      <div className="form">
        <div style={{ display: 'flex', gap: 6 }}>{[1, 2, 3, 4].map((i) => <span key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= step ? 'var(--green)' : '#333' }} />)}</div>
        <div className="muted" style={{ fontSize: 12, margin: '6px 0 14px' }}>Step {step} of 4</div>
        {step === 1 && (<>
          <h2 style={{ fontSize: 22 }}>Create your account</h2>
          <label htmlFor="jp">Mobile number</label>
          <input id="jp" type="tel" inputMode="tel" autoComplete="tel" placeholder="081 234 5678" value={f.phone} onChange={set('phone')} />
          <label htmlFor="jw">Password (min. 8 characters)</label>
          <input id="jw" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} />
        </>)}
        {step === 2 && (<>
          <h2 style={{ fontSize: 22 }}>About you</h2>
          <p className="muted" style={{ fontSize: 13 }}>As on your ID. We verify every player.</p>
          <label htmlFor="fn">First name</label><input id="fn" type="text" autoComplete="given-name" value={f.firstName} onChange={set('firstName')} />
          <label htmlFor="ln">Surname</label><input id="ln" type="text" autoComplete="family-name" value={f.lastName} onChange={set('lastName')} />
          <label htmlFor="db">Date of birth (DD/MM/YYYY)</label>
          <input id="db" type="text" inputMode="numeric" placeholder="DD/MM/YYYY" value={f.dob} onChange={set('dob')} />
          {age !== null && age < 18 && <div className="err">You must be 18 or older to join.</div>}
        </>)}
        {step === 3 && (<>
          <h2 style={{ fontSize: 22 }}>Almost there</h2>
          <label className="check"><input type="checkbox" checked={f.a18} onChange={set('a18')} /><span>I am 18 years or older and a resident of Namibia.</span></label>
          <label className="check"><input type="checkbox" checked={f.tc} onChange={set('tc')} /><span>I accept the <Link href="/terms" target="_blank" className="green">Terms &amp; Conditions</Link> and <Link href="/privacy" target="_blank" className="green">Privacy Policy</Link>.</span></label>
          <p className="muted" style={{ fontSize: 12, border: '1px solid #333', borderRadius: 10, padding: 12 }}>Gamble responsibly. You can set limits or self-exclude from your account at any time.</p>
        </>)}
        {step === 4 && (<>
          <h2 style={{ fontSize: 22 }}>Confirm your number</h2>
          {info && <p className="muted" style={{ fontSize: 13 }}>{info}</p>}
          <label htmlFor="otp">SMS code</label>
          <input id="otp" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" value={f.otp} onChange={set('otp')} />
          <button type="button" className="btn ghost" style={{ marginTop: 12 }} disabled={busy} onClick={sendCode}>Send a new code</button>
        </>)}
        {err && <div className="err" role="alert">{err}</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          {step > 1 && <button className="btn ghost block" style={{ flex: '0 0 100px' }} onClick={() => setStep(step - 1)}>Back</button>}
          <button className="btn block" disabled={!ok || busy} onClick={next}>{step === 4 ? (busy ? 'Creating…' : 'Create account') : step === 3 ? (busy ? 'Sending code…' : 'Send code') : 'Continue'}</button>
        </div>
      </div>
    </>
  );
}
