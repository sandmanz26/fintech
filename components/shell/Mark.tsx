/**
 * Sentinel's mark: a ledger of three lines, one flagged in the data hue.
 * The product watches every line of a merchant's ledger and marks the one that needs a person.
 */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false">
      <rect width="32" height="32" rx="7" fill="var(--primary)" />
      <rect x="8" y="9" width="16" height="2.5" rx="1.25" fill="var(--primary-ink)" />
      <rect x="8" y="14.75" width="11" height="2.5" rx="1.25" fill="var(--data)" />
      <rect x="8" y="20.5" width="13" height="2.5" rx="1.25" fill="var(--primary-ink)" />
    </svg>
  );
}
