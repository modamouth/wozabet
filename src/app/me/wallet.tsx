'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, useApp } from '../store';
import { formatNad, parseNadToCents } from '@/lib/money';

interface Row { id: string; amountCents: number; status: string; reason?: string | null; createdAt: string }

const inputStyle = { flex: 1, height: 44, borderRadius: 8, border: '1px solid #444', background: 'var(--bg)', color: '#fff', padding: '0 12px', fontSize: 16 } as const;

export function WalletPanel() {
  const { me, refreshMe } = useApp();
  const [dep, setDep] = useState('');
  const [wd, setWd] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [hist, setHist] = useState<{ deposits: Row[]; withdrawals: Row[] } | null>(null);
  const load = useCallback(() => api<{ deposits: Row[]; withdrawals: Row[] }>('/api/payments').then(setHist).catch(() => {}), []);
  useEffect(() => { void load(); }, [load]);
  if (!me?.user) return null;
  const u = me.user;

  const run = async (path: string, raw: string, done: (c: number) => string) => {
    const cents = parseNadToCents(raw);
    if (cents === null || cents <= 0) return setMsg({ ok: false, text: 'Enter an amount like 150 or 150.50' });
    try { await api(path, { json: { amountCents: cents } }); setMsg({ ok: true, text: done(cents) }); setDep(''); setWd(''); await Promise.all([refreshMe(), load()]); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };

  return (
    <div className="card" style={{ margin: '12px 16px' }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Deposit (mobile wallet)</div>
      {me.paymentsEnabled ? (
        <>
          <div style={{ display: 'flex', gap: 8 }}>
            <input aria-label="Deposit amount in N$" inputMode="decimal" placeholder={`N$ (min ${formatNad(me.minDepositCents)})`} value={dep} onChange={(e) => setDep(e.target.value)} style={inputStyle} />
            <button className="btn" onClick={() => run('/api/payments/deposit', dep, (c) => `Payment request for ${formatNad(c)} sent to ${u.phone}. Approve it on your phone.`)}>Deposit</button>
          </div>
          <p className="muted" style={{ fontSize: 11, margin: '6px 0 0' }}>We send the request to your registered number only.</p>
        </>
      ) : <p className="muted" style={{ fontSize: 12, margin: 0 }}>Deposits are not available yet.</p>}

      <div style={{ fontWeight: 600, margin: '16px 0 8px' }}>Withdraw</div>
      {u.kycStatus === 'verified' ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <input aria-label="Withdrawal amount in N$" inputMode="decimal" placeholder={`N$ (min ${formatNad(me.minWithdrawalCents)})`} value={wd} onChange={(e) => setWd(e.target.value)} style={inputStyle} />
          <button className="btn ghost" onClick={() => run('/api/withdrawals', wd, (c) => `Withdrawal of ${formatNad(c)} requested. We'll review it shortly.`)}>Withdraw</button>
        </div>
      ) : <p className="muted" style={{ fontSize: 12, margin: 0 }}>{u.kycStatus === 'submitted' ? 'Your documents are being reviewed. Withdrawals open once you are verified.' : 'Verify your identity to withdraw.'} {u.kycStatus !== 'submitted' && <Link href="/me/verify" className="green">Verify now ›</Link>}</p>}
      {msg && <p className={msg.ok ? 'green' : 'err'} style={{ fontSize: 13 }}>{msg.text}</p>}

      {hist && (hist.deposits.length > 0 || hist.withdrawals.length > 0) && (
        <>
          <div style={{ fontWeight: 600, margin: '16px 0 4px' }}>Recent transactions</div>
          {[...hist.deposits.map((d) => ({ ...d, kind: 'Deposit' })), ...hist.withdrawals.map((w) => ({ ...w, kind: 'Withdrawal' }))]
            .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 10).map((r) => (
              <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 0', borderTop: '1px solid var(--line)' }}>
                <span>{r.kind} · {new Date(r.createdAt).toLocaleDateString('en-GB')}</span>
                <span>{formatNad(r.amountCents)} <span className="muted">{r.status}</span></span>
              </div>
            ))}
        </>
      )}
    </div>
  );
}
