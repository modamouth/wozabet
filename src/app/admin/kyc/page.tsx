'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, useApp } from '../../store';

interface S { id: string; name: string; phone: string; dob: string; idType: string; idNumber: string; docMime: string; status: string; reason: string | null; createdAt: string }

export default function AdminKyc() {
  const { me } = useApp();
  const [status, setStatus] = useState<'submitted' | 'approved' | 'rejected'>('submitted');
  const [list, setList] = useState<S[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const load = useCallback(() => api<{ submissions: S[] }>(`/api/admin/kyc?status=${status}`).then((r) => setList(r.submissions)).catch((e) => setMsg(e.message)), [status]);
  useEffect(() => { if (me?.user?.role === 'admin') void load(); }, [me, load]);
  if (!me?.user || me.user.role !== 'admin') return <div className="empty">Admins only.</div>;

  const decide = async (s: S, action: 'approve' | 'reject') => {
    let body: object = { action };
    if (action === 'approve' && !confirm(`Approve ${s.name}? Check that the name, date of birth (${s.dob}) and ID number match the document.`)) return;
    if (action === 'reject') {
      const reason = prompt('Reason (shown to the player, e.g. "Photo is blurry" or "Name does not match"):');
      if (!reason?.trim()) return;
      body = { action, reason };
    }
    try { await api(`/api/admin/kyc/${s.id}`, { json: body }); setMsg(`${s.name}: ${action === 'approve' ? 'verified' : 'rejected'}`); setOpen(null); await load(); }
    catch (e) { setMsg((e as Error).message); }
  };

  return (
    <>
      <h2 className="title">Identity verification</h2>
      <div className="chips">
        {(['submitted', 'approved', 'rejected'] as const).map((s) => <button key={s} className={status === s ? 'chip on' : 'chip'} aria-pressed={status === s} onClick={() => setStatus(s)}>{s}</button>)}
      </div>
      {msg && <div className="warn" style={{ margin: '8px 16px' }}>{msg}</div>}
      {list?.length === 0 && <div className="empty">No {status} submissions.</div>}
      {list?.map((s) => (
        <div className="card" key={s.id}>
          <div className="muted" style={{ fontSize: 12 }}>{new Date(s.createdAt).toLocaleString('en-GB')} · {s.phone}</div>
          <div style={{ fontWeight: 600, margin: '6px 0' }}>{s.name}</div>
          <div style={{ fontSize: 13 }}>DOB {s.dob} · {s.idType === 'national_id' ? 'Namibian ID' : 'Passport'} <b>{s.idNumber}</b></div>
          {s.reason && <div className="muted" style={{ fontSize: 12 }}>Reason: {s.reason}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="btn ghost" onClick={() => setOpen(open === s.id ? null : s.id)}>{open === s.id ? 'Hide document' : 'View document'}</button>
            {s.status === 'submitted' && <button className="btn" onClick={() => decide(s, 'approve')}>Approve</button>}
            {s.status === 'submitted' && <button className="btn danger" onClick={() => decide(s, 'reject')}>Reject</button>}
          </div>
          {open === s.id && (s.docMime === 'application/pdf'
            ? <iframe title="ID document" src={`/api/admin/kyc/${s.id}/document`} style={{ width: '100%', height: 480, marginTop: 10, border: 0, background: '#fff' }} />
            // eslint-disable-next-line @next/next/no-img-element
            : <img alt={`ID document for ${s.name}`} src={`/api/admin/kyc/${s.id}/document`} style={{ width: '100%', marginTop: 10, borderRadius: 8 }} />)}
        </div>
      ))}
    </>
  );
}
