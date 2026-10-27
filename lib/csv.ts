/** RFC 4180 CSV. Cells that start with = + - @ are prefixed so spreadsheets never run them as formulas. */
export function toCsv(headers: string[], rows: (string | number | bigint | null | undefined)[][]): string {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function minorToDecimal(v: bigint | null | undefined): string {
  if (v === null || v === undefined) return "";
  const neg = v < 0n;
  const a = neg ? -v : v;
  return `${neg ? "-" : ""}${a / 100n}.${(a % 100n).toString().padStart(2, "0")}`;
}
