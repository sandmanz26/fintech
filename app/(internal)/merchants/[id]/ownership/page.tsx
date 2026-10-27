import { db } from "@/lib/db";
import { requireStaff, viewerTz } from "@/lib/session";
import { can } from "@/lib/auth/rbac";
import { maskDob, maskId, fmtDate } from "@/lib/format";
import { OwnerReveal, HitReview } from "@/components/merchant/OwnerActions";

const SCREEN: Record<string, { cls: string; label: string }> = {
  NOT_SCREENED: { cls: "outline", label: "Not screened" },
  CLEAR: { cls: "", label: "Clear" },
  POTENTIAL_MATCH: { cls: "warn", label: "Possible match" },
  CONFIRMED_MATCH: { cls: "ink", label: "Confirmed match" },
};
const LIST: Record<string, string> = { SANCTIONS_MOCK: "Sanctions (mock)", PEP_MOCK: "Politically exposed (mock)", TERMINATED_MERCHANT_MOCK: "Terminated merchants (mock)", TERMINATED_INTERNAL: "Our terminated merchant list" };

export default async function OwnershipTab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireStaff();
  const tz = await viewerTz();
  const m = await db.merchant.findUniqueOrThrow({ where: { id }, include: { owners: { include: { hits: { orderBy: { createdAt: "desc" } } }, orderBy: { ownershipPct: "desc" } } } });
  const users = new Map((await db.user.findMany({ select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const total = m.owners.reduce((a, o) => a + Number(o.ownershipPct), 0);
  const canPii = can(user.role, "owner.pii.read");
  const canReview = can(user.role, "case.work");
  const roots = m.owners.filter((o) => !o.parentOwnerId);
  const children = (pid: string) => m.owners.filter((o) => o.parentOwnerId === pid);
  const hits = m.owners.flatMap((o) => o.hits.map((h) => ({ ...h, owner: o })));

  const Node = ({ o, depth }: { o: (typeof m.owners)[number]; depth: number }) => (
    <li style={{ paddingLeft: depth ? 20 : 0, position: "relative" }}>
      {depth ? <span aria-hidden style={{ position: "absolute", left: 6, top: 0, bottom: "50%", width: 10, borderLeft: "1px solid var(--control)", borderBottom: "1px solid var(--control)" }} /> : null}
      <div className="list-row" style={{ minHeight: 40, padding: "6px 0" }}>
        <span style={{ fontWeight: 500 }}>{o.fullName}</span>
        {o.isController ? <span className="chip">Controller</span> : null}
        <span className={`pill ${SCREEN[o.screeningStatus]?.cls ?? ""}`}>{SCREEN[o.screeningStatus]?.label ?? o.screeningStatus}</span>
        <span className="money" style={{ marginLeft: "auto" }}>{Number(o.ownershipPct).toFixed(0)}%</span>
      </div>
      {children(o.id).length ? (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {children(o.id).map((c) => (
            <Node key={c.id} o={c} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );

  return (
    <div className="grid-1-1" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr)" }}>
      <section className="panel" aria-labelledby="tree-h">
        <header>
          <div>
            <h2 id="tree-h">Ownership</h2>
            <div className="meta">Beneficial owners and controllers on file</div>
          </div>
          <span className={`pill ${total >= 75 || m.owners.some((o) => o.isController) ? "" : "warn"}`}>{total.toFixed(0)}% identified</span>
        </header>
        <div className="list-row" style={{ minHeight: 36, padding: "4px 0", borderBottom: "1px solid var(--rule)" }}>
          <span style={{ fontWeight: 600 }}>{m.legalName}</span>
          <span className="meta id">{m.registrationNo}</span>
        </div>
        <ul style={{ listStyle: "none", margin: 0, padding: "4px 0 0 12px" }} aria-label="Ownership tree">
          {roots.map((o) => (
            <Node key={o.id} o={o} depth={1} />
          ))}
        </ul>
      </section>

      <div className="col">
        <section className="panel flush" aria-labelledby="owners-h">
          <header>
            <h2 id="owners-h">Owners</h2>
            <span className="meta">{canPii ? "Revealing full details is recorded in the audit log" : "Personal details are masked for your role"}</span>
          </header>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table className="data responsive-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="n">Share</th>
                  <th>Nationality</th>
                  <th>Date of birth</th>
                  <th>ID number</th>
                  {canPii ? <th aria-label="Reveal" /> : null}
                </tr>
              </thead>
              <tbody>
                {m.owners.map((o) => (
                  <tr key={o.id} data-owner={o.id}>
                    <td>
                      {o.fullName}
                      <span className="sub">{o.isController ? "Controller" : "Owner"}</span>
                    </td>
                    <td className="n money">{Number(o.ownershipPct).toFixed(0)}%</td>
                    <td data-line2>{o.nationality ?? "—"}</td>
                    <td className="num" data-dob>{maskDob(o.dateOfBirth)}</td>
                    <td className="id" data-idno>{maskId(o.idNumber)}</td>
                    {canPii ? (
                      <td className="n">
                        <OwnerReveal merchantId={id} ownerId={o.id} />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel" aria-labelledby="hits-h">
          <header>
            <div>
              <h2 id="hits-h">Watchlist screening</h2>
              <div className="meta">
                Sanctions, PEP and terminated-merchant lists (mock providers) and our own terminated list · rescreened monthly and on every list update
                {(() => {
                  const last = m.owners.map((o) => o.lastScreenedAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
                  return last ? ` · last screened ${fmtDate(last, tz)}` : "";
                })()}
              </div>
            </div>
          </header>
          {hits.length ? (
            <div className="list-rows">
              {hits.map((h) => (
                <div key={h.id} style={{ padding: "12px 0" }}>
                  <div className="row-gap" style={{ justifyContent: "space-between" }}>
                    <div>
                      <strong style={{ fontWeight: 500 }}>{h.owner.fullName}</strong> <span className="muted">matched</span> <strong style={{ fontWeight: 500 }}>{h.matchedName}</strong>
                      <div className="meta">
                        {LIST[h.listName] ?? h.listName} · similarity <span className="num">{h.matchScore}</span>/100 · found {fmtDate(h.createdAt, tz)}
                      </div>
                    </div>
                    <span className={`pill ${h.status === "CONFIRMED" ? "ink" : h.status === "PENDING_REVIEW" ? "warn" : ""}`}>
                      {h.status === "PENDING_REVIEW" ? "To review" : h.status === "CONFIRMED" ? "Confirmed" : "False positive"}
                    </span>
                  </div>
                  {h.status === "PENDING_REVIEW" ? (
                    canReview ? <HitReview hitId={h.id} ownerName={h.owner.fullName} /> : <div className="meta" style={{ marginTop: 6 }}>Waiting for review by risk or compliance.</div>
                  ) : (
                    <div className="meta" style={{ marginTop: 6 }}>
                      {h.reviewedById ? `${users.get(h.reviewedById)} · ${fmtDate(h.reviewedAt, tz)} · ` : ""}
                      {h.reviewNote}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">{m.owners.every((o) => o.screeningStatus === "NOT_SCREENED") ? "Owners have not been screened yet." : `All ${m.owners.length} owners screened; no matches.`}</div>
          )}
        </section>
      </div>
    </div>
  );
}
