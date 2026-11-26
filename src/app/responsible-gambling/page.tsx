import Link from 'next/link';

export const metadata = { title: 'Responsible gambling – Wozabet' };

export default function ResponsibleGambling() {
  return (
    <article style={{ padding: '0 16px 24px', lineHeight: 1.55, fontSize: 15 }}>
      <h2 className="title" style={{ paddingLeft: 0 }}>Responsible gambling</h2>
      <p><b>18+ only.</b> Betting should be entertainment, not a way to make money. Only bet what you can afford to lose.</p>
      <h3 style={{ fontSize: 17, marginTop: 20 }}>Warning signs</h3>
      <ul>
        <li>Chasing losses or betting more to win back money</li>
        <li>Borrowing money or selling things to gamble</li>
        <li>Gambling affecting your work, family or sleep</li>
        <li>Feeling anxious, guilty or hiding your gambling</li>
      </ul>
      <h3 style={{ fontSize: 17, marginTop: 20 }}>Tools in your account</h3>
      <ul>
        <li><Link href="/me/limits" className="green">Deposit and loss limits</Link> (daily, weekly, monthly)</li>
        <li><Link href="/me/limits" className="green">Session time reminders</Link></li>
        <li><Link href="/me/break" className="green">Cool-off</Link> (24 hours, 7 days, 30 days)</li>
        <li><Link href="/me/break" className="green">Self-exclusion</Link> (1 month, 6 months, permanent)</li>
      </ul>
      <h3 style={{ fontSize: 17, marginTop: 20 }}>Get help</h3>
      {/* LEGAL: replace with verified Namibian helpline(s) and the regulator's contact details before launch */}
      <div className="warn">[Placeholder: verified Namibian problem-gambling helpline, counselling service and regulator contact details to be supplied by the compliance team.]</div>
      <p className="muted" style={{ fontSize: 13 }}>Wozabet is licensed in Namibia. [Placeholder: licence number and licensing authority.]</p>
    </article>
  );
}
