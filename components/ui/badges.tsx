import type { RiskBand, Severity, MerchantStatus, CaseStatus } from "@prisma/client";
import { MERCHANT_STATUS_LABEL } from "@/lib/domain/merchantStateMachine";
import { CASE_STATUS_LABEL } from "@/lib/domain/caseStateMachine";
import { slaState, type SlaState } from "@/lib/format";
import { clsx } from "clsx";

/** Colour is meaning, always paired with a word (DESIGN.md §2.2). Fine things are grey. */

const BAND: Record<RiskBand, { cls: string; label: string }> = {
  LOW: { cls: "", label: "Low" },
  MEDIUM: { cls: "warn", label: "Medium" },
  HIGH: { cls: "neg", label: "High" },
  PROHIBITED: { cls: "ink", label: "Prohibited" },
};

export function BandPill({ band, score }: { band: RiskBand | null | undefined; score?: number | null }) {
  if (!band) return <span className="pill outline">Not scored</span>;
  const b = BAND[band];
  return (
    <span className={clsx("pill", b.cls)} data-band={band}>
      {b.label}
      {score !== undefined && score !== null && band !== "PROHIBITED" ? <span className="num" style={{ opacity: 0.8 }}>{score}</span> : null}
    </span>
  );
}

const SEV: Record<Severity, string> = { LOW: "", MEDIUM: "warn", HIGH: "neg", CRITICAL: "ink" };
const SEV_LABEL: Record<Severity, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", CRITICAL: "Critical" };

export function SeverityPill({ severity }: { severity: Severity }) {
  return <span className={clsx("pill", SEV[severity])}>{SEV_LABEL[severity]}</span>;
}

const STATUS_TONE: Partial<Record<MerchantStatus, string>> = {
  UNDER_REVIEW: "warn",
  RESTRICTED: "neg",
  TERMINATION_PENDING: "neg",
  TERMINATED: "ink",
  DECLINED: "outline",
  CLOSED: "outline",
  PENDING_INFO: "warn",
};

export function MerchantStatusPill({ status }: { status: MerchantStatus }) {
  return <span className={clsx("pill", STATUS_TONE[status] ?? "")}>{MERCHANT_STATUS_LABEL[status]}</span>;
}

export function CaseStatusText({ status }: { status: CaseStatus }) {
  return <span>{CASE_STATUS_LABEL[status]}</span>;
}

export function SlaText({ due, now, resolved }: { due: Date | string; now: Date; resolved?: boolean }) {
  const s: SlaState = slaState(due, now, resolved);
  return (
    <span
      className="num"
      data-sla={s.kind}
      style={{
        color: s.kind === "breached" ? "var(--negative)" : s.kind === "soon" ? "var(--warning)" : s.kind === "done" ? "var(--muted)" : "var(--text)",
        fontWeight: s.kind === "breached" ? 600 : 400,
      }}
    >
      {s.text}
    </span>
  );
}

const PALETTE = [210, 20, 150, 280, 50, 330, 100, 250];
/** A person gets a stable initial and a pale tint of their own hue (identity, not data). */
export function Avatar({ name, size = 24 }: { name: string; size?: number }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = PALETTE[h % PALETTE.length];
  const parts = name.split(/\s+/).filter(Boolean);
  const ini = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        display: "inline-grid",
        placeItems: "center",
        fontSize: size <= 24 ? 11 : 13,
        fontWeight: 600,
        flex: "none",
        background: `hsl(${hue} 60% 92%)`,
        color: `hsl(${hue} 45% 28%)`,
      }}
    >
      {ini.toUpperCase()}
    </span>
  );
}
