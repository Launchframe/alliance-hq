import { describe, expect, it } from "vitest";
import { captureCommitSchema, intakeEvidenceIsValid, intakeResultIsCurrent, redactIntakeText, semanticIntakeSchema, type IntakeResult } from "./intake.shared";

describe("reviewed conversational intake", () => {
  it("allows thoughts without manufacturing a task or a priority", () => {
    const result = semanticIntakeSchema.parse({ priority: null, priorityEvidence: null, actions: [] });
    expect(intakeEvidenceIsValid("Just reflecting on yesterday.", result)).toBe(true);
  });
  it("keeps mixed actions independent and rejects invented evidence", () => {
    const result = semanticIntakeSchema.parse({ priority: null, priorityEvidence: null, actions: [
      { title: "Checklist", description: null, status: "done", priority: null, evidence: "Cookie finished the checklist" },
      { title: "Roster", description: null, status: "open", priority: "low", evidence: "Ferg still needs to confirm the roster." },
    ] });
    expect(intakeEvidenceIsValid("Cookie finished the checklist; Ferg still needs to confirm the roster.", result)).toBe(true);
    expect(intakeEvidenceIsValid("Only a thought", result)).toBe(false);
    expect(intakeEvidenceIsValid("Not urgent.", { priority: "urgent", priorityEvidence: null, actions: [] })).toBe(false);
  });
  it("redacts binding IDs and credentials before interpretation", () => {
    const text = redactIntakeText(`Player ${"1".repeat(14)} password=example-secret Bearer example-token`);
    expect(/\d{12,20}/.test(text)).toBe(false);
    expect(text.includes("example-secret") || text.includes("example-token")).toBe(false);
  });
  it("rejects stale draft, override, and principal scopes", () => {
    const result = { draftId: "draft-one", revision: 2, overrideRevision: 4, scope: "alliance:owner" } as IntakeResult;
    expect(intakeResultIsCurrent(result, result)).toBe(true);
    for (const patch of [{ draftId: "another" }, { revision: 3 }, { overrideRevision: 5 }, { scope: "alliance:peer" }]) expect(intakeResultIsCurrent(result, { ...result, ...patch })).toBe(false);
  });
  it("retains explicit inclusion choices and requires stable capture receipts", () => {
    expect(captureCommitSchema.safeParse({ body: "Thought" }).success).toBe(false);
    const capture = captureCommitSchema.parse({ requestId: "request-one", body: "Check the roster", tasks: [{ actionKey: "action-one", included: false, evidence: "Check the roster", title: "Check roster" }] });
    expect(capture.tasks[0]).toMatchObject({ included: false, priority: null, status: "open" });
  });
});
