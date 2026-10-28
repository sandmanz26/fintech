import { db } from "@/lib/db";
import { requireStaff, viewerTz } from "@/lib/session";
import { can } from "@/lib/auth/rbac";
import { simToday } from "@/lib/clock";
import { fmtDate, humanize } from "@/lib/format";
import { DocReview } from "@/components/merchant/DocReview";
import { ApiLink } from "@/components/ui/ApiLink";

export default async function DocumentsTab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireStaff();
  const [docs, tz, today] = await Promise.all([db.document.findMany({ where: { merchantId: id }, orderBy: { uploadedAt: "desc" } }), viewerTz(), simToday()]);
  const canReview = can(user.role, "underwriting.decide.standard");
  return (
    <section className="panel flush" aria-labelledby="docs-h">
      <header>
        <h2 id="docs-h">Documents</h2>
        <span className="meta">{docs.length} on file</span>
      </header>
      {docs.length ? (
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="data responsive-table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Status</th>
                <th>Expires</th>
                <th className="n">Uploaded</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => {
                const expired = d.expiresAt && d.expiresAt < today;
                const soon = d.expiresAt && !expired && d.expiresAt.getTime() - today.getTime() < 30 * 86_400_000;
                const status = expired ? "EXPIRED" : d.status;
                return (
                  <tr key={d.id}>
                    <td>
                      {humanize(d.type)}
                      <span className="sub">{d.fileName ?? "file"}{d.rfiId ? " · sent through the merchant portal" : ""}</span>
                    </td>
                    <td>
                      <span className={`pill ${status === "ACCEPTED" ? "" : status === "PENDING_REVIEW" ? "warn" : "neg"}`}>{status === "PENDING_REVIEW" ? "To review" : humanize(status)}</span>
                    </td>
                    <td data-line2 style={{ color: expired ? "var(--negative)" : soon ? "var(--warning)" : undefined }}>{d.expiresAt ? fmtDate(d.expiresAt, tz) : "—"}</td>
                    <td className="n num">{fmtDate(d.uploadedAt, tz)}</td>
                    <td className="n">
                      <div className="row-gap" style={{ justifyContent: "flex-end" }}>
                        <ApiLink className="link" path={`/documents/${d.id}/file`} target="_blank" rel="noreferrer">Preview</ApiLink>
                        {canReview && d.status === "PENDING_REVIEW" ? <DocReview docId={d.id} /> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ padding: 20 }}>
          <div className="empty">No documents yet. Request them from a case with an RFI.</div>
        </div>
      )}
    </section>
  );
}
