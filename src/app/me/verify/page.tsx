'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useApp } from '../../store';

interface State { status: 'unverified' | 'submitted' | 'verified' | 'rejected'; lastReason: string | null }

const field = { width: '100%', height: 44, borderRadius: 8, border: '1px solid #444', background: 'var(--bg)', color: '#fff', padding: '0 12px', fontSize: 16 } as const;

export default function Verify() {
  const { me, refreshMe } = useApp();
  const [st, setSt] = useState<State | null>(null);
  const [idType, setIdType] = useState<'national_id' | 'passport'>('national_id');
  const [idNumber, setIdNumber] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = () => fetch('/api/kyc', { cache: 'no-store' }).then((r) => r.json()).then(setSt).catch(() => {});
  useEffect(() => { if (me?.user) void load(); }, [me]);
  if (!me?.user) return <div className="empty">Please <Link href="/login" className="green">log in</Link>.</div>;
  if (!st) return <div className="empty">Loading…</div>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return setErr('Choose a photo or scan of your ID');
    setBusy(true); setErr('');
    const fd = new FormData();
    fd.set('idType', idType); fd.set('idNumber', idNumber); fd.set('document', file);
    const res = await fetch('/api/kyc', { method: 'POST', body: fd });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(body?.error?.message ?? 'Upload failed');
    await Promise.all([load(), refreshMe()]);
  };

  return (
    <>
      <h2 className="title">Verify your identity</h2>
      <div className="card" style={{ margin: '12px 16px' }}>
        {st.status === 'verified' && <p className="green" style={{ margin: 0 }}>You are verified. Withdrawals are enabled.</p>}
        {st.status === 'submitted' && <p style={{ margin: 0 }}>Thanks, we&apos;re checking your documents. This usually takes less than one working day.</p>}
        {(st.status === 'unverified' || st.status === 'rejected') && (
          <form onSubmit={submit} className="form" style={{ padding: 0 }}>
            {st.status === 'rejected' && <div className="err" style={{ marginBottom: 12 }}>Your last submission was not accepted: {st.lastReason}</div>}
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>The law requires us to verify every player before paying out. Your document is stored privately and only seen by our compliance team.</p>
            <label>ID type
              <select value={idType} onChange={(e) => setIdType(e.target.value as 'national_id' | 'passport')} style={field}>
                <option value="national_id">Namibian ID card</option>
                <option value="passport">Passport</option>
              </select>
            </label>
            <label>{idType === 'national_id' ? 'ID number (11 digits)' : 'Passport number'}
              <input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} inputMode={idType === 'national_id' ? 'numeric' : 'text'} autoComplete="off" style={field} required />
            </label>
            <label>Photo or scan (JPG, PNG or PDF, max 5 MB)
              <input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ ...field, padding: 10, height: 'auto' }} required />
            </label>
            {err && <div className="err">{err}</div>}
            <button className="btn" disabled={busy} style={{ width: '100%', marginTop: 12 }}>{busy ? 'Uploading…' : 'Submit for review'}</button>
          </form>
        )}
      </div>
      <div className="note"><Link href="/me">‹ Back to account</Link></div>
    </>
  );
}
