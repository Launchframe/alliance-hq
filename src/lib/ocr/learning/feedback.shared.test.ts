import { describe, expect, it } from "vitest";
import { buildFeedbackPayload, snapshotReviewRows } from "./feedback.shared";

const original = [{ id: "row-a", ocrName: "Álpha", score: "100", rank: 1, memberId: "member-a", memberName: "Alpha", frameIndex: 2, manuallyAdded: 0, deleted: 0 }];

describe("attributable review feedback", () => {
  it("keeps observed names distinct from canonical identity changes and preserves exact zero", () => {
    const payload = buildFeedbackPayload(original, [{ id: "row-a", memberId: "member-b", memberName: "Beta", score: "0", rank: 1 }], []);
    expect(payload.rows[0]).toMatchObject({ id: "row-a", before: { observedName: "Álpha", score: "100", memberId: "member-a" }, after: { score: "0", memberId: "member-b", memberName: "Beta" }, changes: ["score", "memberId", "memberName"], evidenceFrameIndex: 2, labelStatus: "candidate" });
  });

  it("does not call an automatic deletion a human negative label", () => {
    const payload = buildFeedbackPayload(original, [{ id: "row-a", deleted: true }], ["row-a"]);
    expect(payload.rows[0]).toMatchObject({ deletionSource: "automatic", labelStatus: "candidate" });
    expect(buildFeedbackPayload(original, [{ id: "row-a", deleted: true }], [], undefined, true).rows[0].deletionSource).toBe("human");
    expect(buildFeedbackPayload(original, [{ id: "row-a", deleted: true }], []).rows[0].deletionSource).toBe("unknown");
  });

  it("never treats a manually added row's ordering index as image provenance", () => {
    const manual = [{ ...original[0], id: "manual", manuallyAdded: 1, frameIndex: -1 }];
    const payload = buildFeedbackPayload(manual, [{ id: "manual", score: "20", memberId: "member-a" }], []);
    expect(payload.rows[0]).toMatchObject({ manuallyAdded: true, evidenceFrameIndex: null });
  });

  it("rejects duplicate and foreign review row ids before any write", () => {
    expect(() => buildFeedbackPayload(original, [{ id: "foreign", score: "1" }], [])).toThrow("invalid_rows");
    expect(() => buildFeedbackPayload(original, [{ id: "row-a" }, { id: "row-a" }], [])).toThrow("invalid_rows");
  });

  it("snapshots only permitted row fields and does not retain credentials", () => {
    const rows = snapshotReviewRows([{ ...original[0], token: "never-retain-this" }]);
    expect(JSON.stringify(rows)).not.toContain("never-retain-this");
    expect(rows[0]).toMatchObject({ observedName: "Álpha", score: "100", evidenceFrameIndex: 2 });
  });
});
