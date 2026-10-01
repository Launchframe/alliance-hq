import { describe, expect, it } from "vitest";
import { draftStateSchema, applyDraftInterpretation, draftActionIsCurrent, editDraftAction, reviewedDraftTasks } from "./drafts.shared";
import type { IntakeResult } from "./intake.shared";

const result: IntakeResult = { draftId: "draft-one", revision: 1, overrideRevision: 0, bodyHash: "hash", rosterHash: "roster", scope: "alliance:owner", preferenceVersion: 1, priority: "urgent", priorityEvidence: "Urgent", actions: [{ actionKey: "one", title: "Check roster", description: null, status: "open", priority: "urgent", evidence: "Check roster", included: true }] };
describe("capture draft audience", () => {
  it("defaults to private and validates the explicit officer-read choice", () => {
    expect(draftStateSchema.parse({ fields: { body: "Check roster" }, revision: 1 }).audience).toBe("private");
    expect(draftStateSchema.parse({ fields: { body: "Check roster" }, revision: 1, audience: "officers_read" }).audience).toBe("officers_read");
    expect(draftStateSchema.safeParse({ fields: { body: "Check roster" }, revision: 1, audience: "everyone" }).success).toBe(false);
  });
  it("keeps officer-read audience when interpretation updates other fields", () => {
    const state = draftStateSchema.parse({ fields: { body: "Check roster" }, revision: 1, audience: "officers_read" });
    expect(applyDraftInterpretation(state, result).audience).toBe("officers_read");
  });
});

describe("durable draft provenance", () => {
  it("keeps each manual field locked without freezing other inferred fields", () => {
    let state = draftStateSchema.parse({ fields: { body: "Check roster. Urgent", priorityMode: "auto" }, revision: 1 });
    state = applyDraftInterpretation(state, result);
    state = editDraftAction(state, "one", { priority: null });
    state = applyDraftInterpretation(state, { ...result, overrideRevision: 1, actions: [{ ...result.actions[0], status: "in_progress" }] });
    expect(state.tasks[0]).toMatchObject({ priority: null, status: "in_progress", modes: { priority: "manual", status: "auto" } });
  });
  it("preserves excluded actions and discards stale analysis", () => {
    const state = editDraftAction(applyDraftInterpretation(draftStateSchema.parse({ fields: { body: "Check roster" }, revision: 1 }), result), "one", { included: false });
    expect(applyDraftInterpretation(state, result)).toEqual(state);
    expect(applyDraftInterpretation(state, { ...result, overrideRevision: 1 }).tasks[0].included).toBe(false);
  });
  it("hides stale inferred tasks from review while keeping excluded current tasks", () => {
    const stale = applyDraftInterpretation(draftStateSchema.parse({ fields: { body: "Check roster" }, revision: 1 }), result);
    const next = { ...stale, revision: 2 };
    expect(draftActionIsCurrent(next.tasks[0], next)).toBe(false);
    expect(reviewedDraftTasks(next)).toEqual([]);
    const excluded = editDraftAction(stale, "one", { included: false });
    expect(draftActionIsCurrent(excluded.tasks[0], excluded)).toBe(true);
    expect(reviewedDraftTasks(excluded)).toEqual([]);
  });
});
