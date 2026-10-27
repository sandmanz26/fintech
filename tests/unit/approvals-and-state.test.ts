import { describe, it, expect } from "vitest";
import { checkCanDecide, checkCanCancel, approverRolesFor } from "@/lib/domain/approvals/policy";
import {
  MERCHANT_TRANSITIONS,
  assertMerchantTransition,
  canTransitionMerchant,
  TERMINAL_MERCHANT_STATES,
} from "@/lib/domain/merchantStateMachine";
import { assertCaseTransition, canTransitionCase, CASE_TRANSITIONS } from "@/lib/domain/caseStateMachine";
import { IllegalTransitionError } from "@/lib/errors";
import { can, canDecideBand, assertCan, ForbiddenError, isInternal } from "@/lib/auth/rbac";

const req = (over = {}) => ({
  status: "PENDING",
  actionType: "APPLY_CONTROL",
  requestedById: "u-analyst",
  approverRole: "RISK_MANAGER" as const,
  payload: {},
  ...over,
});

describe("four-eyes", () => {
  it("requester cannot approve their own request, even as risk manager", () => {
    const r = checkCanDecide(req({ requestedById: "u-rm" }), { id: "u-rm", role: "RISK_MANAGER" });
    expect(r).toMatchObject({ ok: false, code: "SAME_PERSON" });
  });
  it("a different risk manager can approve", () => {
    expect(checkCanDecide(req(), { id: "u-rm", role: "RISK_MANAGER" })).toEqual({ ok: true });
  });
  it("wrong role is refused", () => {
    expect(checkCanDecide(req(), { id: "u-sa", role: "SENIOR_ANALYST" })).toMatchObject({ ok: false, code: "WRONG_ROLE" });
    expect(checkCanDecide(req(), { id: "u-co", role: "COMPLIANCE" })).toMatchObject({ ok: false, code: "WRONG_ROLE" });
  });
  it("compliance may approve compliance terminations only", () => {
    const t = req({ actionType: "TERMINATE", payload: { reasonCategory: "COMPLIANCE" } });
    expect(checkCanDecide(t, { id: "u-co", role: "COMPLIANCE" })).toEqual({ ok: true });
    const f = req({ actionType: "TERMINATE", payload: { reasonCategory: "FRAUD" } });
    expect(checkCanDecide(f, { id: "u-co", role: "COMPLIANCE" })).toMatchObject({ ok: false });
    expect(approverRolesFor("ADD_TO_TERMINATED_LIST", {})).toEqual(["RISK_MANAGER", "COMPLIANCE"]);
  });
  it("already decided requests cannot be decided again", () => {
    expect(checkCanDecide(req({ status: "APPROVED" }), { id: "u-rm", role: "RISK_MANAGER" })).toMatchObject({ code: "NOT_PENDING" });
  });
  it("only the requester can cancel, and only while pending", () => {
    expect(checkCanCancel(req(), { id: "u-analyst" })).toEqual({ ok: true });
    expect(checkCanCancel(req(), { id: "other" })).toMatchObject({ code: "NOT_REQUESTER" });
    expect(checkCanCancel(req({ status: "REJECTED" }), { id: "u-analyst" })).toMatchObject({ code: "NOT_PENDING" });
  });
});

describe("merchant state machine", () => {
  it("allows every transition in PRD §7.1", () => {
    const pairs: [string, string][] = [
      ["APPLICATION_DRAFT", "SUBMITTED"],
      ["SUBMITTED", "IN_UNDERWRITING"],
      ["IN_UNDERWRITING", "PENDING_INFO"],
      ["PENDING_INFO", "IN_UNDERWRITING"],
      ["IN_UNDERWRITING", "APPROVED"],
      ["IN_UNDERWRITING", "DECLINED"],
      ["APPROVED", "ACTIVE"],
      ["ACTIVE", "UNDER_REVIEW"],
      ["UNDER_REVIEW", "ACTIVE"],
      ["UNDER_REVIEW", "RESTRICTED"],
      ["RESTRICTED", "ACTIVE"],
      ["UNDER_REVIEW", "TERMINATION_PENDING"],
      ["RESTRICTED", "TERMINATION_PENDING"],
      ["ACTIVE", "CLOSED"],
      ["TERMINATION_PENDING", "TERMINATED"],
    ];
    for (const [a, b] of pairs) expect(canTransitionMerchant(a as never, b as never), `${a}->${b}`).toBe(true);
    const count = Object.values(MERCHANT_TRANSITIONS).reduce((s, x) => s + x.length, 0);
    expect(count).toBe(pairs.length);
  });
  it("rejects anything else with IllegalTransitionError", () => {
    expect(() => assertMerchantTransition("ACTIVE", "TERMINATED")).toThrow(IllegalTransitionError);
    expect(() => assertMerchantTransition("DECLINED", "ACTIVE")).toThrow(/cannot move/);
    expect(() => assertMerchantTransition("ACTIVE", "UNDER_REVIEW")).not.toThrow();
  });
  it("terminal states have no exits", () => {
    for (const s of TERMINAL_MERCHANT_STATES) expect(MERCHANT_TRANSITIONS[s]).toEqual([]);
  });
});

describe("case state machine", () => {
  it("allows PRD §7.2 transitions", () => {
    expect(canTransitionCase("NEW", "ASSIGNED")).toBe(true);
    expect(canTransitionCase("ASSIGNED", "IN_REVIEW")).toBe(true);
    expect(canTransitionCase("IN_REVIEW", "AWAITING_MERCHANT")).toBe(true);
    expect(canTransitionCase("AWAITING_MERCHANT", "IN_REVIEW")).toBe(true);
    expect(canTransitionCase("IN_REVIEW", "PENDING_APPROVAL")).toBe(true);
    expect(canTransitionCase("PENDING_APPROVAL", "IN_REVIEW")).toBe(true);
    expect(canTransitionCase("PENDING_APPROVAL", "RESOLVED")).toBe(true);
    expect(canTransitionCase("IN_REVIEW", "RESOLVED")).toBe(true);
    expect(canTransitionCase("RESOLVED", "REOPENED")).toBe(true);
    expect(canTransitionCase("REOPENED", "IN_REVIEW")).toBe(true);
    expect(CASE_TRANSITIONS.ASSIGNED).toContain("ASSIGNED");
  });
  it("rejects illegal ones", () => {
    expect(() => assertCaseTransition("NEW", "RESOLVED")).toThrow(IllegalTransitionError);
    expect(() => assertCaseTransition("RESOLVED", "IN_REVIEW")).toThrow();
    expect(() => assertCaseTransition("NEW", "ASSIGNED")).not.toThrow();
  });
});

describe("rbac", () => {
  it("matches the PRD matrix on key cells", () => {
    expect(can("ANALYST", "underwriting.decide.standard")).toBe(true);
    expect(can("ANALYST", "underwriting.decide.high")).toBe(false);
    expect(can("SENIOR_ANALYST", "control.reserve.small")).toBe(true);
    expect(can("ANALYST", "control.reserve.small")).toBe(false);
    expect(can("AUDITOR", "audit.verify")).toBe(true);
    expect(can("ANALYST", "audit.read")).toBe(false);
    expect(can("ADMIN", "users.manage")).toBe(true);
    expect(can("MERCHANT", "merchant.read")).toBe(false);
    expect(can(null, "merchant.read")).toBe(false);
    expect(isInternal("MERCHANT")).toBe(false);
    expect(isInternal("AUDITOR")).toBe(true);
  });
  it("band routing", () => {
    expect(canDecideBand("ANALYST", "LOW")).toBe(true);
    expect(canDecideBand("ANALYST", "MEDIUM")).toBe(true);
    expect(canDecideBand("ANALYST", "HIGH")).toBe(false);
    expect(canDecideBand("SENIOR_ANALYST", "HIGH")).toBe(true);
    expect(canDecideBand("RISK_MANAGER", "PROHIBITED")).toBe(false);
  });
  it("assertCan throws ForbiddenError with status 403", () => {
    try {
      assertCan("ANALYST", "rules.write");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenError);
      expect((e as ForbiddenError).status).toBe(403);
    }
  });
});
