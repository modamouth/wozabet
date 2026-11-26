'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, useApp } from '../../store';
import { formatNad } from '@/lib/money';

interface W { id: string; name: string; phone: string; kycStatus: string; amountCents: number; msisdn: string; status: string; reason: string | null; createdAt: string }

export default function AdminWithdrawals() {
  const { me } = useApp();
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [list, setList] = useState<W[] | null>(null);
  const [msg, setMsg] = useState('');
  const load = useCallback(() => api<{ withdrawals: W[] }>(`/api/admin/withdrawals?status=${status}`).then((r) => setList(r.withdrawals)).catch((e) => setMsg(e.message)), [status]);
  useEffect(() => { if (me?.user?.role === 'admin') void load(); }, [me, load]);
  if (!me?.user || me.user.role !== 'admin') return <div className="empty">Admins only.</div>;

  const decide = async (w: W, action: 'approve' | 'reject') => {
    let body: object = { action };
    if (action === 'approve' && !confirm(`Approve ${formatNad(w.amountCents)} to ${w.msisdn}? Only approve once the payout has been sent or is queued in the wallet merchant portal.`)) return;
    if (action === 'reject') {
      const reason = prompt('Reason for rejecting (shown to the player):');
      if (!reason?.trim()) return;
      body = { action, reason };
    }
    try { await api(`/api/admin/withdrawals/${w.id}`, { json: body }); setMsg(`Withdrawal ${action === 'approve' ? 'approved' : 'rejected and refunded'}.`); await load(); }
    catch (e) { setMsg((e as Error).message); }
  };

  return (
    <>
      <h2 className="title">Withdrawals</h2>
      <div className="chips" style={{ padding: '0 16px' }}>
        {(['pending', 'approved', 'rejected'] as const).map((s) => <button key={s} className={status === s ? 'chip on' : 'chip'} aria-pressed={status === s} onClick={() => setStatus(s)}>{s}</button>)}
      </div>
      {msg && <div className="warn" style={{ margin: '8px 16px' }}>{msg}</div>}
      {list?.length === 0 && <div className="empty">No {status} withdrawals.</div>}
      {list?.map((w) => (
        <div className="card" key={w.id}>
          <div className="muted" style={{ fontSize: 12 }}>{new Date(w.createdAt).toLocaleString('en-GB')} · KYC: {w.kycStatus}</div>
          <div style={{ fontWeight: 600, margin: '6px 0' }}>{w.name} · {w.phone}</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{formatNad(w.amountCents)} <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>to {w.msisdn}</span></div>
          {w.reason && <div className="muted" style={{ fontSize: 12 }}>Reason: {w.reason}</div>}
          {w.status === 'pending' && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="btn" onClick={() => decide(w, 'approve')}>Approve</button>
              <button className="btn danger" onClick={() => decide(w, 'reject')}>Reject &amp; refund</button>
            </div>
          )}
        </div>
      ))}
    </>
  );
}
