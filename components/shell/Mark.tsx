/**
 * Sentinel's mark: a shield holding three ledger lines, one flagged in the data hue.
 * The product guards every line of a merchant's ledger and flags the one that needs a person.
 * Colours come from tokens, so the tile inverts in dark mode. Same drawing as app/icon.svg.
 */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false">
      <rect width="32" height="32" rx="7.5" fill="var(--primary)" />
      <path d="M16 4.4 26.2 8V15.7c0 5.9-4.1 10.3-10.2 12.3C9.9 26 5.8 21.6 5.8 15.7V8z" fill="var(--primary-ink)" />
      <rect x="10.4" y="10.9" width="11.2" height="2.6" rx="1.3" fill="var(--primary)" />
      <rect x="10.4" y="15.5" width="7" height="2.6" rx="1.3" fill="var(--data)" />
      <circle cx="20.6" cy="16.8" r="1.65" fill="var(--data)" />
      <rect x="12.3" y="20.1" width="7.4" height="2.6" rx="1.3" fill="var(--primary)" />
    </svg>
  );
}
