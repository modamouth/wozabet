import Link from 'next/link';

/** Site-wide footer. Compliance text must stay visible on every page. */
export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-grid">
        <div>
          <div className="age" aria-label="18 plus only">18+</div>
          <p><b>Gambling can be addictive. Please play responsibly.</b> Only bet what you can afford to lose. Under-18s are not allowed to open an account or gamble.</p>
        </div>
        <nav aria-label="Responsible gambling">
          <h3>Stay in control</h3>
          <Link href="/responsible-gambling">Responsible gambling</Link>
          <Link href="/me/limits">Deposit &amp; loss limits</Link>
          <Link href="/me/break">Take a break / self-exclude</Link>
        </nav>
        <nav aria-label="Legal">
          <h3>Legal</h3>
          <Link href="/terms">Terms &amp; Conditions</Link>
          <Link href="/privacy">Privacy Policy</Link>
        </nav>
        <div>
          <h3>Licence</h3>
          {/* LEGAL: replace with the licence number and issuing authority */}
          <p className="muted">Wozabet is licensed to offer betting in Namibia. [Licence number and licensing authority to be added.]</p>
        </div>
      </div>
      <p className="footer-base muted">© {new Date().getFullYear()} Wozabet. All amounts in Namibian dollars.</p>
    </footer>
  );
}
