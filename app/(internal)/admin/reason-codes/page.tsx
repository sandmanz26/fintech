import { db } from "@/lib/db";
import { requireStaff } from "@/lib/session";
import { can } from "@/lib/auth/rbac";
import { ReasonCodeRow, NewReasonCode } from "@/components/admin/ReasonCodes";

export const metadata = { title: "Reason codes" };

const CATEGORY: Record<string, string> = { UNDERWRITING: "Underwriting", CONTROL: "Controls", ALERT_DISMISS: "Alert dismissal", CASE_RESOLUTION: "Case resolution", TERMINATION: "Termination" };

export default async function ReasonCodesPage() {
  const user = await requireStaff();
  const editable = can(user.role, "reasoncodes.write");
  const codes = await db.reasonCode.findMany({ orderBy: [{ category: "asc" }, { code: "asc" }] });
  const groups = Object.keys(CATEGORY).map((c) => ({ c, rows: codes.filter((r) => r.category === c) }));
  return (
    <div className="col">
      <p className="muted" style={{ margin: 0 }}>Every decision carries one of these. The merchant-facing text is what the merchant reads; it never names a rule or a score.</p>
      {groups.map((g) => (
        <section key={g.c} className="panel flush" aria-labelledby={`rc-${g.c}`}>
          <header><h2 id={`rc-${g.c}`}>{CATEGORY[g.c]}</h2><span className="meta">{g.rows.length}</span></header>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table className="data responsive-table">
              <thead><tr><th style={{ width: 200 }}>Code</th><th>Label</th><th style={{ width: "42%" }}>Merchant reads</th><th>Status</th></tr></thead>
              <tbody>
                {g.rows.map((r) => <ReasonCodeRow key={r.code} rc={r} editable={editable} />)}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {editable ? <NewReasonCode categories={CATEGORY} /> : null}
    </div>
  );
}
