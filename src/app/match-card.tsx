'use client';
import { useApp, type Match } from './store';
import { formatOdds } from '@/lib/money';

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const t = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `Today · ${t}` : `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · ${t}`;
};

export default function MatchCard({ m }: { m: Match }) {
  const { picks, toggle } = useApp();
  const live = m.status === 'live';
  return (
    <div className="match">
      <div className="meta">
        <span>{m.sport} · {m.league}</span>
        {live ? <span className="livebadge">LIVE</span> : <span>{fmtTime(m.kickoff)}</span>}
      </div>
      <div className="teams">
        <div><span>{m.home}</span>{live && <b>{m.homeScore ?? 0}</b>}</div>
        <div><span>{m.away}</span>{live && <b>{m.awayScore ?? 0}</b>}</div>
      </div>
      {m.odds.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>Odds coming soon</div> : (
        <div className="odds" style={{ gridTemplateColumns: `repeat(${m.odds.length}, minmax(0,1fr))` }}>
          {m.odds.map((o) => {
            const on = picks[m.id]?.selection === o.selection;
            const name = o.selection === '1' ? m.home : o.selection === '2' ? m.away : 'Draw';
            return (
              <button key={o.selection} className={'odd' + (on ? ' on' : '')} disabled={o.suspended} aria-pressed={on}
                aria-label={`${name} at ${formatOdds(o.priceMilli)}`} onClick={() => toggle(m, o)}>
                <small>{o.selection}</small>
                <strong>{o.suspended ? '–' : formatOdds(o.priceMilli)}</strong>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
