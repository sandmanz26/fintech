import Link from "next/link";
import { db } from "@/lib/db";
import { requireStaff, viewerTz } from "@/lib/session";
import { can } from "@/lib/auth/rbac";
import { ruleStats } from "@/lib/domain/rules/service";
import { RuleDefinitionSchema, describeCondition } from "@/lib/domain/rules/dsl";
import { SeverityPill } from "@/components/ui/badges";
import { RowLink } from "@/components/ui/RowLink";
import { fmtDate } from "@/lib/format";
import { Forbidden } from "@/components/ui/Forbidden";

export const metadata = { title: "Rules" };

/** Rules list with each rule's performance (PRD §6.3, §6.8). */
export default async function RulesPage() {
  const user = await requireStaff();
  if (!can(user.role, "rules.read")) return <Forbidden what="monitoring rules" />;
  const [rules, stats, tz, last] = await Promise.all([
    db.rule.findMany({ include: { versions: { orderBy: { version: "desc" } } }, orderBy: { key: "asc" } }),
    ruleStats(),
    viewerTz(),
    db.alert.groupBy({ by: ["ruleKey"], _max: { metricDate: true } }),
  ]);
  const lastBy = new Map(last.map((l) => [l.ruleKey, l._max.metricDate]));
  return (
    <>
      <div className="title-row">
        <div>
          <h1>Rules</h1>
          <div className="sub">Deterministic checks on each merchant&apos;s daily metrics. Precision is alerts that led to a control or termination, out of those reviewed.</div>
        </div>
        {can(user.role, "rules.write") ? <Link className="btn primary" href="/rules/new">New rule</Link> : null}
      </div>
      <section className="panel flush">
        <div className="table-wrap">
          <table className="data responsive-table">
            <thead>
              <tr>
                <th style={{ width: "38%" }}>Rule</th>
                <th>Severity</th>
                <th className="n">Alerts</th>
                <th className="n">Dismissed</th>
                <th className="n">Led to action</th>
                <th className="n">Last fired</th>
                <th>Version</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => {
                const v = r.versions.find((x) => x.id === r.activeVersionId);
                const def = v ? RuleDefinitionSchema.safeParse(v.definition) : null;
                const s = stats.get(r.key);
                const reviewed = s ? s.total - s.open : 0;
                return (
                  <RowLink key={r.id} href={`/rules/${r.id}`}>
                    <td>
                      <Link className="link" href={`/rules/${r.id}`} tabIndex={-1}>{r.name}</Link>
                      {!r.enabled ? <span className="pill outline" style={{ marginLeft: 8 }}>Off</span> : null}
                      <span className="sub"><span className="id">{r.key}</span>{def?.success ? ` · ${describeCondition(def.data.when)}` : ""}</span>
                    </td>
                    <td>{def?.success ? <SeverityPill severity={def.data.severity} /> : "—"}</td>
                    <td className="n num">{s?.total ?? 0}</td>
                    <td className="n num">{s && reviewed ? `${Math.round((s.dismissed / reviewed) * 100)}%` : <span className="muted">—</span>}</td>
                    <td className="n num">{s && reviewed ? `${Math.round((s.actioned / reviewed) * 100)}%` : <span className="muted">—</span>}</td>
                    <td className="n num">{lastBy.get(r.key) ? fmtDate(lastBy.get(r.key), "UTC") : <span className="muted">Never</span>}</td>
                    <td data-hide-phone className="num">v{v?.version ?? "—"} <span className="meta">· {r.versions.length} total</span></td>
                  </RowLink>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <p className="meta" style={{ marginTop: 10 }}>Last updated {fmtDate(new Date(), tz)}. Rules never use models or scores from outside Sentinel; every alert shows the numbers that fired it.</p>
    </>
  );
}
