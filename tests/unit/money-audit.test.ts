import { describe, it, expect } from "vitest";
import { formatMoney, parseMajor, mulBps, divRound, toBigInt, ratio, jsonSafe, add, minBig, maxBig } from "@/lib/money";
import { canonicalJSON, computeAuditHash, verifyChain, GENESIS_HASH } from "@/lib/domain/audit/hash";

describe("money", () => {
  it("formats minor units exactly", () => {
    expect(formatMoney(125000n)).toBe("$1,250.00");
    expect(formatMoney("5")).toBe("$0.05");
    expect(formatMoney(-990n)).toBe("-$9.90");
    expect(formatMoney(100n, "USD", { sign: true })).toBe("+$1.00");
    expect(formatMoney(900719925474099312n)).toBe("$9,007,199,254,740,993.12");
    expect(formatMoney(1234n, "JPY")).toBe("¥1,234");
    expect(formatMoney(12_500_000n, "USD", { compact: true })).toBe("$125K");
  });
  it("parses major strings", () => {
    expect(parseMajor("1,250.5")).toBe(125050n);
    expect(parseMajor("-3")).toBe(-300n);
    expect(() => parseMajor("1.234")).toThrow();
    expect(() => parseMajor("abc")).toThrow();
  });
  it("rounds half away from zero", () => {
    expect(mulBps(105n, 5000)).toBe(53n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(divRound(5n, 0n)).toBe(0n);
  });
  it("rejects non-integer numbers", () => {
    expect(() => toBigInt(1.5)).toThrow();
    expect(() => toBigInt("1.5")).toThrow();
    expect(toBigInt(null)).toBe(0n);
  });
  it("helpers", () => {
    expect(add(1n, 2n, 3n)).toBe(6n);
    expect(minBig(1n, 2n)).toBe(1n);
    expect(maxBig(1n, 2n)).toBe(2n);
    expect(ratio(1n, 4n)).toBe(0.25);
    expect(ratio(1n, 0n)).toBe(0);
    expect(jsonSafe({ a: 1n })).toEqual({ a: "1" });
  });
});

describe("audit hash chain", () => {
  const row = (prevHash: string, action: string) => {
    const base = {
      occurredAt: new Date("2026-10-27T10:00:00.000Z"),
      actorId: "u1",
      actorRole: "ANALYST",
      action,
      entityType: "Merchant",
      entityId: "m1",
      before: { b: 1, a: 2 },
      after: null,
      prevHash,
    };
    return { ...base, hash: computeAuditHash(base) };
  };
  it("canonical JSON sorts keys and is stable", () => {
    expect(canonicalJSON({ b: 1, a: { d: 1n, c: [new Date(0)] } })).toBe('{"a":{"c":["1970-01-01T00:00:00.000Z"],"d":"1"},"b":1}');
  });
  it("verifies an intact chain and finds the first tampered row", () => {
    const r1 = { id: 1n, ...row(GENESIS_HASH, "A") };
    const r2 = { id: 2n, ...row(r1.hash, "B") };
    const r3 = { id: 3n, ...row(r2.hash, "C") };
    expect(verifyChain([r1, r2, r3])).toEqual({ ok: true, checked: 3 });
    expect(verifyChain([r1, { ...r2, action: "TAMPERED" }, r3])).toMatchObject({ ok: false, firstBrokenId: "2", reason: "hash_mismatch" });
    expect(verifyChain([r1, r3])).toMatchObject({ ok: false, firstBrokenId: "3", reason: "chain_break" });
  });
});
