"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutGrid,
  Inbox,
  UserRoundX,
  BellRing,
  Hourglass,
  TimerOff,
  FileCheck2,
  ShieldCheck,
  Store,
  SlidersHorizontal,
  PieChart,
  ScrollText,
  Settings,
  Menu,
  X,
  Moon,
  Sun,
  LogOut,
  Users,
} from "lucide-react";
import { Mark } from "./Mark";
import { DemoCalendar } from "./DemoCalendar";
import { Avatar } from "@/components/ui/badges";

type Item = { href: string; label: string; icon: React.ReactNode; count?: number; alarm?: boolean; match?: string };
type Group = { label?: string; items: Item[] };

export function Sidebar({
  user,
  counts,
  caps,
  today,
  demo,
  signOutAction,
}: {
  user: { name: string; roleLabel: string };
  counts: { mine: number; unassigned: number; alerts: number; awaiting: number; breaching: number; std: number; enh: number; approvals: number };
  caps: { rules: boolean; audit: boolean; admin: boolean; approvals: boolean; underwriting: boolean };
  today: string;
  demo: { mock: boolean; canAdvance: boolean };
  signOutAction: () => Promise<void>;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);

  const groups: Group[] = [
    { items: [{ href: "/dashboard", label: "Dashboard", icon: <LayoutGrid /> }] },
    {
      label: "Work",
      items: [
        { href: "/queues/my-work", label: "My work", icon: <Inbox />, count: counts.mine },
        { href: "/queues/unassigned", label: "Unassigned", icon: <UserRoundX />, count: counts.unassigned },
        { href: "/queues/alerts-untriaged", label: "Alerts to triage", icon: <BellRing />, count: counts.alerts },
        { href: "/queues/awaiting-merchant", label: "Waiting on merchant", icon: <Hourglass />, count: counts.awaiting },
        { href: "/queues/breaching-sla", label: "Breaching SLA", icon: <TimerOff />, count: counts.breaching, alarm: counts.breaching > 0 },
      ],
    },
    ...(caps.underwriting
      ? [
          {
            label: "Underwriting",
            items: [
              { href: "/queues/underwriting-standard", label: "Standard", icon: <FileCheck2 />, count: counts.std },
              { href: "/queues/underwriting-enhanced", label: "Enhanced", icon: <FileCheck2 />, count: counts.enh },
            ],
          },
        ]
      : []),
    {
      label: "Risk",
      items: [
        ...(caps.approvals ? [{ href: "/approvals", label: "Approvals", icon: <ShieldCheck />, count: counts.approvals }] : []),
        { href: "/merchants", label: "Merchants", icon: <Store /> },
        ...(caps.rules ? [{ href: "/rules", label: "Rules", icon: <SlidersHorizontal /> }] : []),
        { href: "/reports", label: "Portfolio", icon: <PieChart /> },
        ...(caps.audit ? [{ href: "/audit", label: "Audit log", icon: <ScrollText /> }] : []),
        ...(caps.admin ? [{ href: "/admin/users", label: "Admin", icon: <Settings />, match: "/admin" }] : []),
      ],
    },
  ];

  const isActive = (it: Item) => path === it.href || path.startsWith((it.match ?? it.href) + "/") || (it.match ? path.startsWith(it.match) : false);

  return (
    <>
      <div className="phonebar">
        <button className="btn ghost sm" aria-label="Open menu" onClick={() => setOpen(true)}>
          <Menu />
        </button>
        <Mark size={20} />
        <span style={{ fontWeight: 600 }}>Sentinel</span>
      </div>
      <nav className="sidebar" data-open={open} aria-label="Main">
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 8px 12px" }}>
          <Mark size={24} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 600, lineHeight: "18px" }}>Sentinel</div>
            <div className="meta truncate">Kestrel Pay · US merchants</div>
          </div>
          <button className="btn ghost sm phone-only" aria-label="Close menu" onClick={() => setOpen(false)} style={{ display: open ? "inline-flex" : "none" }}>
            <X />
          </button>
        </div>
        {groups.map((g, gi) => (
          <div key={gi} role="group" aria-label={g.label}>
            {g.label ? <div className="group-label">{g.label}</div> : null}
            {g.items.map((it) => (
              <Link key={it.href} href={it.href} className="nav-item" aria-current={isActive(it) ? "page" : undefined}>
                {it.icon}
                <span>{it.label}</span>
                {it.count !== undefined && it.count > 0 ? (
                  <span className={`count${it.alarm ? " alarm" : ""}`} aria-label={`${it.count} items`}>
                    {it.count}
                  </span>
                ) : null}
              </Link>
            ))}
          </div>
        ))}
        <div style={{ marginTop: "auto", paddingTop: 16 }}>
          <DemoCalendar today={today} canAdvance={demo.canAdvance} demo={demo.mock} />
          <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 0", borderRadius: 8 }}>
            <Link href="/login?switch=1" className="persona-switch" title="Switch persona" data-testid="switch-persona">
              <Avatar name={user.name} size={28} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="truncate" style={{ display: "block", fontWeight: 500 }}>{user.name}</span>
                <span className="meta truncate" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {user.roleLabel} <Users aria-hidden style={{ width: 12, height: 12 }} />
                </span>
              </span>
            </Link>
            <ThemeToggle />
            <form action={signOutAction}>
              <button className="btn ghost sm" aria-label="Sign out" title="Sign out">
                <LogOut />
              </button>
            </form>
          </div>
        </div>
      </nav>
    </>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.dataset.theme === "dark"), []);
  const flip = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    document.cookie = `theme=${next}; path=/; max-age=31536000; samesite=lax`;
    setDark(!dark);
  };
  return (
    <button className="btn ghost sm" onClick={flip} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} title="Theme">
      {dark ? <Sun /> : <Moon />}
    </button>
  );
}
