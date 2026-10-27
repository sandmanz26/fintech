"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Underline tabs on a full-width rule; each tab is its own route (app-screens §8.2: one view per area). */
export function TabNav({ tabs, label }: { tabs: { href: string; label: string; count?: number; exact?: boolean }[]; label: string }) {
  const path = usePathname();
  return (
    <nav className="tabs" aria-label={label}>
      {tabs.map((t) => {
        const active = t.exact ? path === t.href : path === t.href || path.startsWith(t.href + "/");
        return (
          <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined}>
            {t.label}
            {t.count !== undefined ? <span className="count">{t.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
