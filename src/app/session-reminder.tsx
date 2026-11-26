'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, useApp } from './store';

const KEY = 'wb_session_start';

/** "Reality check": every N minutes (the player's choice, Me → Limits) show how long this session has lasted. */
export default function SessionReminder() {
  const { me, refreshMe } = useApp();
  const minutes = me?.user?.sessionReminderMinutes ?? null;
  const [shown, setShown] = useState<number | null>(null);

  useEffect(() => {
    if (!me?.user || !minutes) return;
    let start = Number(sessionStorage.getItem(KEY));
    if (!start) { start = Date.now(); sessionStorage.setItem(KEY, String(start)); }
    let next = start + minutes * 60_000;
    while (next <= Date.now()) next += minutes * 60_000; // don't stack missed reminders
    const t = setInterval(() => {
      if (Date.now() >= next) { setShown(Math.round((Date.now() - start) / 60_000)); next += minutes * 60_000; }
    }, 15_000);
    return () => clearInterval(t);
  }, [me?.user, minutes]);

  if (shown === null) return null;
  const logout = async () => { await api('/api/auth/logout', { method: 'POST' }); sessionStorage.removeItem(KEY); await refreshMe(); location.href = '/'; };
  return (
    <>
      <div className="scrim" aria-hidden="true" />
      <div className="sheet" role="alertdialog" aria-labelledby="rc-title" aria-describedby="rc-body">
        <h3 id="rc-title">Time check</h3>
        <p id="rc-body">You&apos;ve been on Wozabet for <b>{shown} minutes</b>. Remember to take breaks and only bet what you can afford.</p>
        <div style={{ display: 'grid', gap: 8 }}>
          <button className="btn block" onClick={() => setShown(null)} autoFocus>Continue</button>
          <Link className="btn ghost block" href="/me/break" onClick={() => setShown(null)}>Take a break</Link>
          <button className="btn ghost block" onClick={logout}>Log out</button>
        </div>
      </div>
    </>
  );
}
