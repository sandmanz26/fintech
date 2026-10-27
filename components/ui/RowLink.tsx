"use client";

import { useRouter } from "next/navigation";

/**
 * A table row that opens its object. Keyboard: focusable, Enter opens, j/k move between rows
 * (KeyboardShortcuts). The first cell also holds a real link for middle-click and screen readers.
 */
export function RowLink({ href, children, selected, testId }: { href: string; children: React.ReactNode; selected?: boolean; testId?: string }) {
  const router = useRouter();
  return (
    <tr
      data-row
      data-href={href}
      data-testid={testId}
      tabIndex={0}
      aria-selected={selected || undefined}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a, button, input, select, textarea, label")) return;
        router.push(href);
      }}
    >
      {children}
    </tr>
  );
}
