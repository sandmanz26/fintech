import Link from "next/link";
import { merchantTimeline } from "@/lib/queries/merchant";
import { viewerTz } from "@/lib/session";
import { fmtDate, fmtTime } from "@/lib/format";

const SOURCE: Record<string, string> = { audit: "Record", case: "Case", control: "Control", alert: "Alert" };

/** "What happened, and who decided?" — four sources in one chronology (PRD §9). */
export default async function TimelineTab({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ source?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const tz = await viewerTz();
  const all = await merchantTimeline(id, 300);
  const items = sp.source ? all.filter((i) => i.source === sp.source) : all;
  const counts = Object.fromEntries(Object.keys(SOURCE).map((k) => [k, all.filter((i) => i.source === k).length]));
  return (
    <section className="panel" aria-labelledby="tl-h">
      <header style={{ flexWrap: "wrap" }}>
        <div>
          <h2 id="tl-h">Timeline</h2>
          <div className="meta">Audit records, case events, controls and alerts, newest first</div>
        </div>
        <div className="segmented" role="group" aria-label="Source">
          <Link href={`/merchants/${id}/timeline`} aria-current={!sp.source ? "true" : undefined}>All {all.length}</Link>
          {Object.entries(SOURCE).map(([k, v]) => (
            <Link key={k} href={`/merchants/${id}/timeline?source=${k}`} aria-current={sp.source === k ? "true" : undefined}>
              {v} {counts[k]}
            </Link>
          ))}
        </div>
      </header>
      {items.length ? (
        <ol className="timeline">
          {items.map((i, n) => (
            <li key={n}>
              <div className="num muted" style={{ fontSize: 13 }}>
                {fmtDate(i.at, tz)}
                <div className="meta">{fmtTime(i.at, tz)}</div>
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="row-gap">
                  <span className="chip">{SOURCE[i.source]}</span>
                  {i.href ? <Link className="link" href={i.href}>{i.title}</Link> : <span style={{ fontWeight: 500 }}>{i.title}</span>}
                </div>
                {i.detail ? <div className="muted" style={{ marginTop: 2, overflowWrap: "anywhere" }}>{i.detail}</div> : null}
                <div className="meta">{i.actor ?? "System"}</div>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="empty">Nothing recorded yet.</div>
      )}
    </section>
  );
}
