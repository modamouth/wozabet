'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, useApp } from '../../store';
import { formatNad } from '@/lib/money';

interface E { id: number; at: string; actorPhone: string | null; actorRole: string | null; action: string; targetType: string | null; targetId: string | null; amountCents: number | null; details: Record<string, unknown>; ip: string | null }
const FILTERS = ['', 'deposit', 'withdrawal', 'kyc', 'fixture', 'bet', 'rg', 'auth', 'admin'];

export default function AdminAudit() {
  const { me } = useApp();
  const [filter, setFilter] = useState(() => (typeof window !== 'undefined' ? (new URLSearchParams(location.search).get('action') ?? '').replace(/\.$/, '') : ''));
  const [list, setList] = useState<E[] | null>(null);
  const [msg, setMsg] = useState('');
  const load = useCallback(() => api<{ entries: E[] }>(`/api/admin/audit${filter ? `?action=${filter}.` : ''}`).then((r) => setList(r.entries)).catch((e) => setMsg(e.message)), [filter]);
  useEffect(() => { if (me?.user?.role === 'admin') void load(); }, [me, load]);
  if (!me?.user || me.user.role !== 'admin') return <div className="empty">Admins only.</div>;
  return (
    <>
      <h2 className="title">Audit log</h2>
      <div className="chips">{FILTERS.map((f) => <button key={f} className={filter === f ? 'chip on' : 'chip'} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f || 'all'}</button>)}</div>
      {msg && <div className="warn" style={{ margin: '8px 16px' }}>{msg}</div>}
      {list?.length === 0 && <div className="empty">No entries.</div>}
      <div style={{ padding: '0 16px' }}>
        {list?.map((e) => (
          <div key={e.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
            <div className="row"><b>{e.action}</b><span className="muted">{new Date(e.at).toLocaleString('en-GB')}</span></div>
            <div className="muted">
              {e.actorPhone ? `${e.actorPhone}${e.actorRole === 'admin' ? ' (admin)' : ''}` : 'system'}
              {e.targetType && ` · ${e.targetType} ${e.targetId?.slice(0, 13)}`}
              {e.amountCents !== null && ` · ${formatNad(e.amountCents)}`}
              {e.ip && e.ip !== 'direct' && ` · ${e.ip}`}
            </div>
            {Object.keys(e.details ?? {}).length > 0 && <code style={{ fontSize: 11, color: 'var(--muted)', wordBreak: 'break-all' }}>{JSON.stringify(e.details)}</code>}
          </div>
        ))}
      </div>
    </>
  );
}
