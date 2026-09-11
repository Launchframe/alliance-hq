import { describe, expect, it } from "vitest";

import { isOfficerAuditSeverity } from "@/lib/bff/officer-action-audit.shared";

describe("isOfficerAuditSeverity", () => {
  it("accepts routine, update, and override", () => {
    expect(isOfficerAuditSeverity("routine")).toBe(true);
    expect(isOfficerAuditSeverity("update")).toBe(true);
    expect(isOfficerAuditSeverity("override")).toBe(true);
    expect(isOfficerAuditSeverity("critical")).toBe(false);
  });
});
