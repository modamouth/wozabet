'use client';
import Link from 'next/link';
import { useApp, type Match } from './store';
import { formatNad } from '@/lib/money';

/** Desktop landing sections for the home page. Every claim here must be true today: no invented bonuses, partners or apps. */

export function Hero() {
  const { me } = useApp();
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <span className="tag">Licensed in Namibia · 18+</span>
        <h1 id="hero-title">Football betting,<br /><span className="green">made for Namibia.</span></h1>
        <p>Bet on the big European leagues and African football in Namibian dollars. Clear odds, fast settlement, and limits you control.</p>
        <div className="hero-cta">
          {me?.user
            ? <a href="#matches" className="btn">Browse matches</a>
            : <><Link href="/join" className="btn">Join now</Link><Link href="/login" className="btn ghost">Log in</Link></>}
        </div>
        <ul className="hero-points">
          <li>Match result, double chance, over/under 2.5, both teams to score</li>
          <li>Singles and accumulators, settled automatically into your wallet</li>
          <li>Deposit and loss limits, time-outs and self-exclusion built in</li>
        </ul>
      </div>
    </section>
  );
}

export function TopCompetitions({ matches, league, setLeague }: { matches: Match[]; league: string | null; setLeague: (l: string | null) => void }) {
  const counts = new Map<string, number>();
  for (const m of matches) counts.set(m.league, (counts.get(m.league) ?? 0) + 1);
  const leagues = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return (
    <section className="block" aria-labelledby="top-title">
      <div className="block-head"><h2 id="top-title">Top sports</h2><span className="muted">Football · {matches.length} upcoming</span></div>
      <div className="sports">
        <div className="sport on"><span aria-hidden="true">⚽</span><b>Football</b><small>{matches.length} matches</small></div>
        <div className="sport soon"><span aria-hidden="true">🏉</span><b>Rugby</b><small>Coming later</small></div>
        <div className="sport soon"><span aria-hidden="true">🏀</span><b>Basketball</b><small>Coming later</small></div>
      </div>
      {leagues.length > 0 && (
        <div className="chips" style={{ padding: '12px 0 0', flexWrap: 'wrap' }}>
          <button className={league === null ? 'chip on' : 'chip'} aria-pressed={league === null} onClick={() => setLeague(null)}>All competitions</button>
          {leagues.map(([l, n]) => <button key={l} className={league === l ? 'chip on' : 'chip'} aria-pressed={league === l} onClick={() => setLeague(l)}>{l} <span style={{ opacity: .7 }}>({n})</span></button>)}
        </div>
      )}
    </section>
  );
}

export function Promotions() {
  return (
    <section className="side-card" aria-labelledby="promo-title">
      <h2 id="promo-title">Promotions</h2>
      <p className="muted">There are no offers running right now.</p>
      <p className="muted">When we run one, the full terms appear right here before you opt in: the minimum deposit, any wagering requirement, eligible bets and the expiry date. No hidden conditions.</p>
      <p className="fine">18+. Promotions are optional and never required to play.</p>
    </section>
  );
}

export function PaymentMethods() {
  const { me } = useApp();
  const live = !!me?.paymentsEnabled;
  return (
    <section className="side-card" aria-labelledby="pay-title">
      <h2 id="pay-title">Payment methods</h2>
      <div className="pay">
        <div className="pay-row"><span className="pay-ico" aria-hidden="true">📱</span><div><b>Mobile wallet</b><small>{live ? 'Available' : 'Launching soon'} · deposits &amp; withdrawals</small></div></div>
        <div className="pay-row soon"><span className="pay-ico" aria-hidden="true">🏦</span><div><b>Bank EFT</b><small>Planned</small></div></div>
      </div>
      <ul className="fine-list">
        {me && <li>Minimum deposit {formatNad(me.minDepositCents)}, minimum withdrawal {formatNad(me.minWithdrawalCents)}</li>}
        <li>All amounts in Namibian dollars (N$)</li>
        <li>Withdrawals go to your own registered number after ID verification</li>
      </ul>
    </section>
  );
}

export function AppBanner() {
  return (
    <section className="appbanner" aria-labelledby="app-title">
      <div>
        <h2 id="app-title">Wozabet on your phone</h2>
        <p>No download needed. Open <b>wozabet</b> in your phone&apos;s browser, then choose <b>Add to Home Screen</b> (Safari: Share menu · Chrome: ⋮ menu). It opens like an app and stays up to date.</p>
      </div>
      <div className="phone" aria-hidden="true"><img src="/logo.png" alt="" /></div>
    </section>
  );
}
