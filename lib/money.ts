/**
 * Money is always a BigInt in minor units plus an ISO 4217 currency code.
 * Never use `number` for an amount; these helpers are the only way in and out.
 */

export type Money = { minor: bigint; currency: string };

const MINOR_DIGITS: Record<string, number> = { USD: 2, EUR: 2, GBP: 2, IDR: 2, SGD: 2, JPY: 0 };

export function minorDigits(currency: string): number {
  return MINOR_DIGITS[currency] ?? 2;
}

export function money(minor: bigint | string | number, currency = "USD"): Money {
  return { minor: toBigInt(minor), currency };
}

export function toBigInt(v: bigint | string | number | null | undefined): bigint {
  if (v === null || v === undefined) return 0n;
  if (typeof v === "bigint") return v;
  if (typeof v === "number") {
    if (!Number.isInteger(v)) throw new Error(`Minor amounts must be integers, got ${v}`);
    return BigInt(v);
  }
  if (!/^-?\d+$/.test(v)) throw new Error(`Invalid minor amount string: ${v}`);
  return BigInt(v);
}

/** Parse a major-unit string such as "1,250.50" into minor units. */
export function parseMajor(input: string, currency = "USD"): bigint {
  const digits = minorDigits(currency);
  const clean = input.replace(/[,\s]/g, "");
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(clean);
  if (!m) throw new Error(`Invalid amount: ${input}`);
  const frac = (m[3] ?? "").padEnd(digits, "0");
  if (frac.length > digits) throw new Error(`Too many decimals for ${currency}: ${input}`);
  const v = BigInt(m[2]) * 10n ** BigInt(digits) + (digits ? BigInt(frac || "0") : 0n);
  return m[1] ? -v : v;
}

export function add(...xs: bigint[]): bigint {
  return xs.reduce((a, b) => a + b, 0n);
}

/** Multiply by a basis-point rate (1% = 100 bps), rounding half away from zero. */
export function mulBps(amount: bigint, bps: number | bigint): bigint {
  const b = typeof bps === "bigint" ? bps : BigInt(Math.round(bps));
  return divRound(amount * b, 10_000n);
}

/** Multiply by an integer count (days, etc.). */
export function mulInt(amount: bigint, n: number): bigint {
  return amount * BigInt(Math.round(n));
}

/** Integer division rounding half away from zero. */
export function divRound(a: bigint, b: bigint): bigint {
  if (b === 0n) return 0n;
  const neg = a < 0n !== b < 0n;
  const absA = a < 0n ? -a : a;
  const absB = b < 0n ? -b : b;
  const q = (absA + absB / 2n) / absB;
  return neg ? -q : q;
}

export function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export function maxBig(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

/** Ratio of two minor amounts as a JS number (for display or comparisons, never for storage). */
export function ratio(a: bigint, b: bigint): number {
  if (b === 0n) return 0;
  return Number((a * 1_000_000n) / b) / 1_000_000;
}

/** Format minor units with Intl, e.g. 125000n USD -> "$1,250.00". */
export function formatMoney(
  minor: bigint | string | number,
  currency = "USD",
  opts: { locale?: string; compact?: boolean; sign?: boolean } = {},
): string {
  const v = toBigInt(minor);
  const digits = minorDigits(currency);
  const divisor = 10n ** BigInt(digits);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / divisor;
  const frac = abs % divisor;
  // Intl formats the integer part exactly (BigInt-safe); we append the fraction ourselves.
  const nf = new Intl.NumberFormat(opts.locale ?? "en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    ...(opts.compact ? { notation: "compact", maximumFractionDigits: 1 } : {}),
  });
  if (opts.compact) {
    const approx = Number(abs) / Number(divisor);
    const s = nf.format(approx);
    return `${neg ? "-" : opts.sign && v > 0n ? "+" : ""}${s}`;
  }
  const parts = nf.formatToParts(whole);
  const decimalSep = new Intl.NumberFormat(opts.locale ?? "en-US").formatToParts(1.1).find((p) => p.type === "decimal")?.value ?? ".";
  let out = "";
  for (const p of parts) out += p.value;
  if (digits > 0) {
    // Insert the fraction right after the last integer group.
    const fracStr = frac.toString().padStart(digits, "0");
    const lastInt = [...parts].reverse().find((p) => p.type === "integer");
    if (lastInt) {
      const idx = out.lastIndexOf(lastInt.value) + lastInt.value.length;
      out = out.slice(0, idx) + decimalSep + fracStr + out.slice(idx);
    }
  }
  return `${neg ? "-" : opts.sign && v > 0n ? "+" : ""}${out}`;
}

/** JSON-safe serialisation: BigInt -> string. */
export function jsonSafe<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}
