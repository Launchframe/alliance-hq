import { describe, expect, it } from "vitest";
import {
  depositSlipDraftToParsedRowFields,
  parsedRowFieldsToDepositSlipDraft,
} from "./draft-row.shared";
import type { ParsedDepositSlipDraft } from "./parse-deposit-slip-text.shared";

describe("draft-row outcomeAmount round-trip", () => {
  it("preserves outcomeAmount through rank column", () => {
    const draft: ParsedDepositSlipDraft = {
      depositAt: "2025-06-01T10:00:00Z",
      termDays: 3,
      amount: 5000,
      status: "matured",
      outcomeAmount: 5750,
      outcomeKind: "total_return",
      identity: {
        gameServerNumber: null,
        allianceTag: "TST",
        commanderName: "TestCommander",
        rawIdentity: "TestCommander",
      },
      sourceFrameIndex: 2,
    };
    const fields = depositSlipDraftToParsedRowFields(draft);
    expect(fields.rank).toBe(5750);
    const restored = parsedRowFieldsToDepositSlipDraft(fields);
    expect(restored).not.toBeNull();
    expect(restored!.outcomeAmount).toBe(5750);
  });

  it("handles null outcomeAmount", () => {
    const draft: ParsedDepositSlipDraft = {
      depositAt: "2025-06-01T10:00:00Z",
      termDays: 5,
      amount: 3000,
      status: "locked",
      outcomeAmount: null,
      outcomeKind: null,
      identity: {
        gameServerNumber: null,
        allianceTag: null,
        commanderName: "Player",
        rawIdentity: "Player",
      },
    };
    const fields = depositSlipDraftToParsedRowFields(draft);
    expect(fields.rank).toBeNull();
    const restored = parsedRowFieldsToDepositSlipDraft(fields);
    expect(restored!.outcomeAmount).toBeNull();
  });

  it("round-trips outcomeAt via rosterRankRaw @suffix", () => {
    const draft: ParsedDepositSlipDraft = {
      depositAt: "2026-07-10T12:00:00.000Z",
      termDays: 1,
      amount: 5000,
      status: "matured",
      outcomeAmount: 5700,
      outcomeKind: "total_return",
      outcomeAt: "2026-07-11T14:30:00.000Z",
      identity: {
        gameServerNumber: null,
        allianceTag: "LFgo",
        commanderName: "Lifecycle",
        rawIdentity: "Lifecycle",
      },
    };
    const fields = depositSlipDraftToParsedRowFields(draft);
    expect(fields.rosterRankRaw).toBe(
      "total_return@2026-07-11T14:30:00.000Z",
    );
    const restored = parsedRowFieldsToDepositSlipDraft(fields);
    expect(restored?.outcomeKind).toBe("total_return");
    expect(restored?.outcomeAt).toBe("2026-07-11T14:30:00.000Z");
  });

  it("ignores unknown rosterRankRaw kinds even with @suffix", () => {
    const restored = parsedRowFieldsToDepositSlipDraft({
      ocrName: "Player",
      score: "1000",
      powerLevel: "2026-07-10T12:00:00.000Z",
      memberLevel: 1,
      profession: "locked",
      allianceRankTitle: null,
      rosterRankRaw: "not_a_kind@2026-07-11T14:30:00.000Z",
      rank: null,
      frameIndex: null,
    });
    expect(restored?.outcomeKind).toBeNull();
    expect(restored?.outcomeAt).toBeNull();
  });
});
