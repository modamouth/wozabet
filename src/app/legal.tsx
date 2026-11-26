import Link from 'next/link';

/** Placeholder legal page: headings only, for counsel to fill in. Nothing here is legal text. */
export function LegalPlaceholder({ title, sections }: { title: string; sections: string[] }) {
  return (
    <article className="legal">
      <h1>{title}</h1>
      <div className="warn" role="note"><b>Draft placeholder.</b> This page has not been written yet. Wozabet&apos;s legal counsel will supply the final text before launch.</div>
      {sections.map((s, i) => (
        <section key={s}>
          <h2>{i + 1}. {s}</h2>
          <p className="muted">[To be completed by legal counsel.]</p>
        </section>
      ))}
      <p className="muted" style={{ marginTop: 24 }}>Questions? See <Link href="/responsible-gambling" className="green">Responsible gambling</Link>.</p>
    </article>
  );
}
