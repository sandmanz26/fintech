import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireStaff, viewerTz } from "@/lib/session";
import { can } from "@/lib/auth/rbac";
import { RuleDefinitionSchema } from "@/lib/domain/rules/dsl";
import { ruleStats } from "@/lib/domain/rules/service";
import { fmtDate } from "@/lib/format";
import { RuleEditor } from "@/components/rules/RuleEditor";
import { RuleToggles } from "@/components/rules/RuleToggles";
import { Forbidden } from "@/components/ui/Forbidden";

export const metadata = { title: "Rule" };

export default async function RulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireStaff();
  if (!can(user.role, "rules.read")) return <Forbidden what="monitoring rules" />;
  const canWrite = can(user.role, "rules.write");
  if (id === "new") {
    if (!canWrite) return <Forbidden what="creating rules" />;
    return (
      <>
        <div className="crumbs"><Link href="/rules">Rules</Link><span aria-hidden>/</span><span>New</span></div>
        <div className="title-row"><div><h1>New rule</h1><div className="sub">Build it, backtest it against 90 days, then save it with a change note.</div></div></div>
        <RuleEditor ruleId={null} initial={null} name="" description="" canWrite />
      </>
    );
  }
  const rule = await db.rule.findUnique({ where: { id }, include: { versions: { orderBy: { version: "desc" } } } });
  if (!rule) notFound();
  const [tz, users, stats] = await Promise.all([viewerTz(), db.user.findMany({ select: { id: true, name: true } }), ruleStats()]);
  const name = new Map(users.map((u) => [u.id, u.name]));
  const active = rule.versions.find((v) => v.id === rule.activeVersionId);
  const def = active ? RuleDefinitionSchema.safeParse(active.definition) : null;
  const s = stats.get(rule.key);
  const system = rule.key === "R-LIMIT-BREACH";
  return (
    <>
      <div className="crumbs"><Link href="/rules">Rules</Link><span aria-hidden>/</span><span className="id">{rule.key}</span></div>
      <div className="title-row">
        <div>
          <div className="row-gap">
            <h1>{rule.name}</h1>
            <span className={`pill ${rule.enabled ? "" : "outline"}`}>{rule.enabled ? `On · v${active?.version}` : "Off"}</span>
          </div>
          <div className="sub">{rule.description}</div>
        </div>
        {canWrite && !system ? <RuleToggles ruleId={rule.id} enabled={rule.enabled} /> : null}
      </div>
      <div className="kpis" style={{ marginBottom: 16 }}>
        <div className="kpi"><div className="kpi-label">Alerts, all time</div><div className="kpi-value num">{s?.total ?? 0}</div><div className="kpi-sub">{s?.open ?? 0} still to triage</div></div>
        <div className="kpi"><div className="kpi-label">Dismissed</div><div className="kpi-value num">{s?.dismissed ?? 0}</div><div className="kpi-sub">with a reason code</div></div>
        <div className="kpi"><div className="kpi-label">Led to a control or termination</div><div className="kpi-value num">{s?.actioned ?? 0}</div><div className="kpi-sub">precision signal</div></div>
        <div className="kpi"><div className="kpi-label">Versions</div><div className="kpi-value num">{rule.versions.length}</div><div className="kpi-sub">every change kept</div></div>
      </div>
      {system ? (
        <div className="notice info" style={{ marginBottom: 16 }}>System rule: raised by the transaction pipeline when a limit control is exceeded. It is not evaluated on daily metrics and cannot be edited.</div>
      ) : (
        <RuleEditor ruleId={rule.id} initial={def?.success ? def.data : null} name={rule.name} description={rule.description} canWrite={canWrite} />
      )}
      <section className="panel flush" style={{ marginTop: 16 }} aria-labelledby="ver-h">
        <header><h2 id="ver-h">Versions</h2></header>
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="data responsive-table">
            <thead><tr><th>Version</th><th>Change note</th><th>By</th><th className="n">Saved</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {rule.versions.map((v) => (
                <tr key={v.id}>
                  <td className="num">v{v.version}{v.id === rule.activeVersionId ? <span className="pill" style={{ marginLeft: 8 }}>Active</span> : null}</td>
                  <td data-line2>{v.changeNote}</td>
                  <td>{name.get(v.createdById) ?? "—"}</td>
                  <td className="n num">{fmtDate(v.createdAt, tz)}</td>
                  <td className="n">{canWrite && !system && v.id !== rule.activeVersionId ? <RuleToggles ruleId={rule.id} activateVersionId={v.id} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
