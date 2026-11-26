'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, useApp } from '../store';
import { formatNad } from '@/lib/money';

interface Summary {
  kycPending: number; withdrawalsPending: number; withdrawalsPendingCents: number; paymentsReview: number; toSettle: number;
  openBets: number; openStakesCents: number; players: number; fixturesUpcoming: number; pricedUpcoming: number; lastOddsUpdate: string | null;
}

function Tile({ href, label, value, sub, alert }: { href?: string; label: string; value: string | number; sub?: string; alert?: boolean }) {
  const body = (
    <>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div className="tile-num" style={alert ? { color: 'var(--green)' } : undefined}>{value}</div>
      {sub && <div className="muted" style={{ fontSize: 12 }}>{sub}</div>}
    </>
  );
  return href ? <Link href={href} className={'tile' + (alert ? ' alert' : '')}>{body}<span className="tile-go">Open ›</span></Link> : <div className="tile">{body}</div>;
}

export default function AdminDashboard() {
  const { me } = useApp();
  const [s, setS] = useState<Summary | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<Summary>('/api/admin/summary').then(setS).catch((e) => setMsg(e.message)), []);
  useEffect(() => { if (me?.user?.role === 'admin') void load(); }, [me, load]);
  if (!me) return <div className="empty">Loading…</div>;
  if (!me.user || me.user.role !== 'admin') return <div className="empty">Admins only.</div>;

  const sync = async () => {
    setBusy(true); setMsg('');
    try {
      const r = await api<{ fixtures: number; withOdds: number; errors: string[]; requests: { used: number; dailyRemaining: number | null; stopped: string | null } }>('/api/cron/sync', { method: 'POST' });
      setMsg(`Synced ${r.fixtures} fixtures (${r.withOdds} with odds), ${r.requests.used} API requests${r.requests.dailyRemaining !== null ? `, ${r.requests.dailyRemaining} left today` : ''}${r.requests.stopped ? ` · stopped: ${r.requests.stopped}` : ''}${r.errors.length ? ` · errors: ${r.errors.join('; ')}` : ''}`);
      await load();
    } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  };

  return (
    <>
      <div className="row" style={{ alignItems: 'center', padding: '16px 16px 4px' }}>
        <h2 style={{ fontSize: 22 }}>Admin dashboard</h2>
        <button className="btn" disabled={busy} onClick={sync}>{busy ? 'Syncing…' : 'Sync odds & fixtures now'}</button>
      </div>
      {msg && <div className="warn" style={{ margin: '8px 16px' }} role="status">{msg}</div>}
      {!s ? <div className="empty">Loading…</div> : (
        <>
          <h3 className="dash-h">Needs attention</h3>
          <div className="tiles">
            <Tile href="/admin/kyc" label="Identity checks to review" value={s.kycPending} alert={s.kycPending > 0} />
            <Tile href="/admin/withdrawals" label="Withdrawals pending" value={s.withdrawalsPending} sub={formatNad(s.withdrawalsPendingCents)} alert={s.withdrawalsPending > 0} />
            <Tile href="/admin/audit?action=deposit." label="Deposits parked for review" value={s.paymentsReview} sub="Check against the provider statement" alert={s.paymentsReview > 0} />
            <Tile href="/admin/results" label="Matches to result & settle" value={s.toSettle} alert={s.toSettle > 0} />
          </div>
          <h3 className="dash-h">Book</h3>
          <div className="tiles">
            <Tile label="Open bets" value={s.openBets} sub={`${formatNad(s.openStakesCents)} staked`} />
            <Tile label="Players" value={s.players} />
            <Tile label="Upcoming matches" value={s.fixturesUpcoming} sub={`${s.pricedUpcoming} with live prices`} />
            <Tile label="Last odds update" value={s.lastOddsUpdate ? new Date(s.lastOddsUpdate).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '–'} sub={s.lastOddsUpdate ? new Date(s.lastOddsUpdate).toLocaleDateString('en-GB') : 'No sync yet'} />
          </div>
          <h3 className="dash-h">Tools</h3>
          <div className="menu card" style={{ padding: '0 14px' }}>
            <Link href="/admin/results">Results &amp; settlement <span className="muted">›</span></Link>
            <Link href="/admin/kyc">Identity checks (KYC) <span className="muted">›</span></Link>
            <Link href="/admin/withdrawals">Withdrawals <span className="muted">›</span></Link>
            <Link href="/admin/audit">Audit log <span className="muted">›</span></Link>
          </div>
        </>
      )}
    </>
  );
}
