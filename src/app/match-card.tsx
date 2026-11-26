'use client';
import { useState } from 'react';
import { useApp, type Match, type Odd } from './store';
import { formatOdds } from '@/lib/money';
import { MARKETS, MARKET_KEYS, selectionLabel } from '@/lib/markets';

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const t = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `Today · ${t}` : `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · ${t}`;
};

/** Short button captions per market. */
const SHORT: Record<string, string> = { '1x2:1': '1', '1x2:X': 'X', '1x2:2': '2', 'dc:1X': '1X', 'dc:12': '12', 'dc:X2': 'X2', 'ou25:O': 'Over', 'ou25:U': 'Under', 'btts:Y': 'Yes', 'btts:N': 'No' };

function Row({ m, odds }: { m: Match; odds: Odd[] }) {
  const { picks, toggle } = useApp();
  return (
    <div className="odds" style={{ gridTemplateColumns: `repeat(${odds.length}, minmax(0,1fr))` }}>
      {odds.map((o) => {
        const on = picks[m.id]?.market === o.market && picks[m.id]?.selection === o.selection;
        return (
          <button key={o.market + o.selection} className={'odd' + (on ? ' on' : '')} disabled={o.suspended} aria-pressed={on}
            aria-label={`${selectionLabel(o.market, o.selection, m.home, m.away)} at ${formatOdds(o.priceMilli)}`} onClick={() => toggle(m, o)}>
            <small>{SHORT[`${o.market}:${o.selection}`] ?? o.selection}</small>
            <strong>{o.suspended ? '–' : formatOdds(o.priceMilli)}</strong>
          </button>
        );
      })}
    </div>
  );
}

export default function MatchCard({ m }: { m: Match }) {
  const [more, setMore] = useState(false);
  const live = m.status === 'live';
  const by = (k: string) => m.odds.filter((o) => o.market === k);
  const extra = MARKET_KEYS.filter((k) => k !== '1x2' && by(k).length > 0);
  return (
    <div className="match">
      <div className="meta">
        <span>{m.league}</span>
        {live ? <span className="livebadge">LIVE</span> : <span>{fmtTime(m.kickoff)}</span>}
      </div>
      <div className="teams">
        <div><span>{m.home}</span>{live && <b>{m.homeScore ?? 0}</b>}</div>
        <div><span>{m.away}</span>{live && <b>{m.awayScore ?? 0}</b>}</div>
      </div>
      {by('1x2').length === 0 ? <div className="muted" style={{ fontSize: 13 }}>Odds coming soon</div> : <Row m={m} odds={by('1x2')} />}
      {extra.length > 0 && (
        <>
          <button className="moremk" aria-expanded={more} onClick={() => setMore(!more)}>{more ? 'Fewer markets' : `+${extra.length} more markets`}</button>
          {more && extra.map((k) => (
            <div key={k} style={{ marginTop: 10 }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{MARKETS[k].label}</div>
              <Row m={m} odds={by(k)} />
            </div>
          ))}
        </>
      )}
    </div>
  );
}
