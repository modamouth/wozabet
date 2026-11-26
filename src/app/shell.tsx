'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from './store';
import { formatNad } from '@/lib/money';
import BetSlip from './betslip';

const I = ({ d }: { d: string }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

export default function Shell({ children }: { children: React.ReactNode }) {
  const { me, picks, setSlipOpen } = useApp();
  const path = usePathname();
  const n = Object.keys(picks).length;
  const cls = (p: string) => (p === '/' ? path === '/' : path.startsWith(p)) ? 'on' : '';
  const authPage = path.startsWith('/join') || path.startsWith('/login');
  return (
    <div className="shell">
      <header className="header">
        <Link href="/" aria-label="Wozabet home"><img src="/logo.png" alt="WozaBet – Come win big!" /></Link>
        <div className="hbtns">
          {me?.user ? (
            <Link href="/me" className="bal">{formatNad(me.user.balanceCents)}</Link>
          ) : me ? (
            <>
              <Link href="/login" className="btn ghost">Log in</Link>
              <Link href="/join" className="btn">Join now</Link>
            </>
          ) : null}
        </div>
      </header>
      <main className="main">{children}</main>
      {!authPage && (
        <nav className="nav" aria-label="Main">
          <Link href="/" className={cls('/')}><I d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />Home</Link>
          <Link href="/live" className={cls('/live')}><I d="M12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0-5zM6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4" />Live</Link>
          <button className="slipbtn" onClick={() => setSlipOpen(true)}>
            <I d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4z" />Bet slip
            {n > 0 && <span className="badge">{n}</span>}
          </button>
          <Link href="/bets" className={cls('/bets')}><I d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" />My bets</Link>
          <Link href="/me" className={cls('/me')}><I d="M12 4a4 4 0 1 0 0 8a4 4 0 0 0 0-8zM4 21a8 8 0 0 1 16 0" />Me</Link>
        </nav>
      )}
      <BetSlip />
    </div>
  );
}
