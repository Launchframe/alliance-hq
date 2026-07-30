import { describe, expect, it } from "vitest";

import { DEPOSIT_AT_PROXIMITY_MS } from "@/lib/banks/deposit-slip-ocr/deposit-slip-dedupe.shared";
import {
  canHistoricalOutcomeUpdateLocked,
  findHistoricalDepositMatch,
  findHighConfidenceHistoricalDepositMatch,
  isHighConfidenceHistoricalDepositMatch,
  isMemberLinkedHistoricalDepositMatch,
  shouldSkipHistoricalDepositDuplicate,
  shouldUpdateHistoricalDepositOutcome,
} from "@/lib/banks/deposit-slip-ocr/deposit-slip-history-match.shared";
import { pickLatestDepositSlip } from "@/lib/banks/deposit-slip-ocr/deposit-slip-latest.shared";
import type { SerializedDepositSlip } from "@/lib/banks/types.shared";

function identity(
  overrides: Partial<{
    commanderName: string;
    depositAt: string;
    amount: number;
    termDays: number;
    depositAllianceTag: string | null;
    status: "locked" | "matured" | "looted";
    allianceMemberId: string | null;
    outcomeAt: string | null;
  }> = {},
) {
  return {
    commanderName: "Blue Investor",
    depositAt: "2026-07-10T12:14:34.000Z",
    amount: 6000,
    termDays: 3,
    depositAllianceTag: "Roar",
    status: "locked" as const,
    allianceMemberId: null as string | null,
    outcomeAt: null as string | null,
    ...overrides,
  };
}

function slip(
  overrides: Partial<SerializedDepositSlip> & { id: string },
): SerializedDepositSlip {
  return {
    bankId: "bank-1",
    depositAt: "2026-07-10T12:14:34.000Z",
    termDays: 3,
    maturesAt: "2026-07-13T12:14:34.000Z",
    status: "locked",
    outcomeAt: null,
    amount: 6000,
    outcomeAmount: null,
    depositAllianceTag: "Roar",
    depositAllianceId: null,
    commanderName: "Blue Investor",
    commanderId: null,
    allianceMemberId: null,
    createdAt: "2026-07-10T12:15:00.000Z",
    updatedAt: "2026-07-10T12:15:00.000Z",
    ...overrides,
  };
}

describe("isHighConfidenceHistoricalDepositMatch", () => {
  it("matches the same commander/amount/term within the proximity window", () => {
    expect(
      isHighConfidenceHistoricalDepositMatch(
        identity({ depositAt: "2026-07-10T12:20:00.000Z" }),
        identity({ depositAt: "2026-07-10T12:14:34.000Z" }),
      ),
    ).toBe(true);
  });

  it("rejects when depositAt is outside the proximity window", () => {
    const outside = new Date(
      Date.parse("2026-07-10T12:14:34.000Z") + DEPOSIT_AT_PROXIMITY_MS + 1,
    ).toISOString();
    expect(
      isHighConfidenceHistoricalDepositMatch(
        identity({ depositAt: outside }),
        identity(),
      ),
    ).toBe(false);
  });

  it("rejects different amounts or terms", () => {
    expect(
      isHighConfidenceHistoricalDepositMatch(identity({ amount: 7000 }), identity()),
    ).toBe(false);
    expect(
      isHighConfidenceHistoricalDepositMatch(identity({ termDays: 1 }), identity()),
    ).toBe(false);
  });

  it("rejects conflicting alliance tags when both are set", () => {
    expect(
      isHighConfidenceHistoricalDepositMatch(
        identity({ depositAllianceTag: "GRoW" }),
        identity({ depositAllianceTag: "Roar" }),
      ),
    ).toBe(false);
  });

  it("allows a missing tag on either side", () => {
    expect(
      isHighConfidenceHistoricalDepositMatch(
        identity({ depositAllianceTag: null }),
        identity({ depositAllianceTag: "Roar" }),
      ),
    ).toBe(true);
  });

  it("rejects an unparsable depositAt instead of throwing", () => {
    expect(
      isHighConfidenceHistoricalDepositMatch(
        identity({ depositAt: "not-a-date" }),
        identity(),
      ),
    ).toBe(false);
  });
});

describe("shouldSkipHistoricalDepositDuplicate / shouldUpdateHistoricalDepositOutcome", () => {
  it("skips same-status identity matches", () => {
    expect(
      shouldSkipHistoricalDepositDuplicate(
        identity({ status: "locked" }),
        identity({ status: "locked" }),
      ),
    ).toBe(true);
    expect(
      shouldUpdateHistoricalDepositOutcome(
        identity({ status: "locked" }),
        identity({ status: "locked" }),
      ),
    ).toBe(false);
  });

  it("does not skip a looted OCR row against a locked history slip", () => {
    const locked = identity({ status: "locked" });
    const looted = identity({
      status: "looted",
      depositAt: "2026-07-10T12:20:00.000Z",
    });
    expect(shouldSkipHistoricalDepositDuplicate(looted, locked)).toBe(false);
    expect(shouldUpdateHistoricalDepositOutcome(looted, locked)).toBe(true);
  });

  it("skips a locked re-upload when history already terminated", () => {
    expect(
      shouldSkipHistoricalDepositDuplicate(
        identity({ status: "locked" }),
        identity({ status: "looted" }),
      ),
    ).toBe(true);
    expect(
      shouldUpdateHistoricalDepositOutcome(
        identity({ status: "locked" }),
        identity({ status: "looted" }),
      ),
    ).toBe(false);
  });

  it("skips without downgrading when two different terminal statuses match", () => {
    // Only locked->matured/looted is a valid outcome update; a deposit cannot
    // legitimately flip between matured and looted, so a proximity match
    // between two different terminal statuses should skip, not overwrite.
    const matured = identity({
      status: "matured",
      depositAt: "2026-07-10T12:14:34.000Z",
    });
    const looted = identity({
      status: "looted",
      depositAt: "2026-07-10T12:20:00.000Z",
    });
    expect(shouldSkipHistoricalDepositDuplicate(looted, matured)).toBe(true);
    expect(shouldUpdateHistoricalDepositOutcome(looted, matured)).toBe(false);
    expect(shouldSkipHistoricalDepositDuplicate(matured, looted)).toBe(true);
    expect(shouldUpdateHistoricalDepositOutcome(matured, looted)).toBe(false);
  });
});

describe("isMemberLinkedHistoricalDepositMatch", () => {
  it("matches the same roster member when OCR commander names differ", () => {
    const banla = identity({
      commanderName: "Banla QC",
      allianceMemberId: "am-bania",
    });
    const bania = identity({
      commanderName: "Bania QC",
      allianceMemberId: "am-bania",
    });
    expect(isMemberLinkedHistoricalDepositMatch(bania, banla)).toBe(true);
    expect(isHighConfidenceHistoricalDepositMatch(bania, banla)).toBe(false);
    expect(shouldSkipHistoricalDepositDuplicate(bania, banla)).toBe(true);
  });

  it("does not match different roster members with the same financials", () => {
    const a = identity({ allianceMemberId: "am-1" });
    const b = identity({ allianceMemberId: "am-2" });
    expect(isMemberLinkedHistoricalDepositMatch(a, b)).toBe(false);
  });

  it("does not match the same roster member when amount or term differs", () => {
    const a = identity({ allianceMemberId: "am-bania", amount: 7000 });
    const b = identity({ allianceMemberId: "am-bania" });
    expect(isMemberLinkedHistoricalDepositMatch(a, b)).toBe(false);
  });

  it("does not match the same roster member when depositAt is unparsable", () => {
    const a = identity({ allianceMemberId: "am-bania", depositAt: "not-a-date" });
    const b = identity({ allianceMemberId: "am-bania" });
    expect(isMemberLinkedHistoricalDepositMatch(a, b)).toBe(false);
  });
});

describe("findHighConfidenceHistoricalDepositMatch", () => {
  it("returns the matching history row", () => {
    const history = [
      identity({ commanderName: "Other", depositAt: "2026-07-09T12:00:00.000Z" }),
      identity({ depositAt: "2026-07-10T12:16:00.000Z" }),
    ];
    expect(findHighConfidenceHistoricalDepositMatch(identity(), history)).toBe(
      history[1],
    );
  });

  it("finds member-linked history when commander OCR differs", () => {
    const history = [
      identity({
        commanderName: "Banla QC",
        allianceMemberId: "am-bania",
      }),
    ];
    expect(
      findHistoricalDepositMatch(
        identity({ commanderName: "Bania QC", allianceMemberId: "am-bania" }),
        history,
      ),
    ).toBe(history[0]);
  });

  it("prefers a lifecycle-locked initiate over a proximity re-deposit", () => {
    const oldLocked = identity({
      status: "locked",
      depositAt: "2026-07-10T12:14:34.000Z",
      termDays: 3,
    });
    const redeposit = identity({
      status: "locked",
      depositAt: "2026-07-13T12:15:00.000Z",
      termDays: 3,
    });
    const matured = identity({
      status: "matured",
      depositAt: "2026-07-13T12:14:34.000Z",
      termDays: 3,
    });
    expect(
      findHistoricalDepositMatch(matured, [redeposit, oldLocked]),
    ).toBe(oldLocked);
    expect(shouldUpdateHistoricalDepositOutcome(matured, oldLocked)).toBe(true);
    expect(shouldUpdateHistoricalDepositOutcome(matured, redeposit)).toBe(false);
  });
});

describe("findHistoricalDepositMatch — cross-job lifecycle", () => {
  it("pairs a matured OCR row with a locked slip when green is days after blue", () => {
    const locked = identity({
      status: "locked",
      depositAt: "2026-07-10T12:00:00.000Z",
      termDays: 3,
    });
    const maturedIncoming = identity({
      status: "matured",
      depositAt: "2026-07-13T12:05:00.000Z",
      termDays: 3,
    });
    expect(canHistoricalOutcomeUpdateLocked(maturedIncoming, locked)).toBe(true);
    expect(findHistoricalDepositMatch(maturedIncoming, [locked])?.status).toBe(
      "locked",
    );
    expect(shouldUpdateHistoricalDepositOutcome(maturedIncoming, locked)).toBe(
      true,
    );
    expect(shouldSkipHistoricalDepositDuplicate(maturedIncoming, locked)).toBe(
      false,
    );
  });

  it("pairs looted OCR with locked when outcome is after initiate within term", () => {
    const locked = {
      id: "h1",
      ...identity({
        status: "locked",
        depositAt: "2026-07-10T12:00:00.000Z",
        termDays: 3,
      }),
    };
    const lootedIncoming = identity({
      status: "looted",
      depositAt: "2026-07-11T08:00:00.000Z",
      termDays: 3,
    });
    expect(canHistoricalOutcomeUpdateLocked(lootedIncoming, locked)).toBe(true);
    expect(findHistoricalDepositMatch(lootedIncoming, [locked])?.id).toBe("h1");
  });

  it("skips re-upload of the same terminal outcome across jobs", () => {
    const stored = identity({
      status: "matured",
      depositAt: "2026-07-10T12:00:00.000Z",
      outcomeAt: "2026-07-13T12:05:00.000Z",
      termDays: 3,
    });
    const reupload = identity({
      status: "matured",
      depositAt: "2026-07-13T12:06:00.000Z",
      termDays: 3,
    });
    expect(shouldSkipHistoricalDepositDuplicate(reupload, stored)).toBe(true);
    expect(shouldUpdateHistoricalDepositOutcome(reupload, stored)).toBe(false);
  });
});

describe("canHistoricalOutcomeUpdateLocked / shouldUpdateHistoricalDepositOutcome — non-matches", () => {
  it("rejects a locked pairing candidate when amount or term does not match", () => {
    const locked = identity({ status: "locked" });
    const looted = identity({
      status: "looted",
      amount: 7000,
      depositAt: "2026-07-10T12:20:00.000Z",
    });
    expect(canHistoricalOutcomeUpdateLocked(looted, locked)).toBe(false);
  });

  it("does not update a locked slip when a looted OCR row shares no identity fields", () => {
    const locked = identity({ status: "locked" });
    const unrelatedLooted = identity({
      status: "looted",
      commanderName: "Someone Else",
      allianceMemberId: null,
      amount: 9999,
      depositAt: "2026-07-10T12:20:00.000Z",
    });
    expect(shouldUpdateHistoricalDepositOutcome(unrelatedLooted, locked)).toBe(
      false,
    );
  });

  it("rejects an unparsable outcome timestamp instead of throwing", () => {
    const locked = identity({ status: "locked" });
    const garbledLooted = identity({
      status: "looted",
      depositAt: "not-a-date",
      outcomeAt: null,
    });
    expect(canHistoricalOutcomeUpdateLocked(garbledLooted, locked)).toBe(
      false,
    );
  });

  it("does not treat two terminal rows as duplicates when a timestamp is unparsable", () => {
    const garbledStored = identity({
      status: "looted",
      depositAt: "not-a-date",
    });
    const incomingLooted = identity({
      status: "looted",
      depositAt: "2026-07-10T12:20:00.000Z",
    });
    expect(
      shouldSkipHistoricalDepositDuplicate(incomingLooted, garbledStored),
    ).toBe(false);
  });
});

describe("pickLatestDepositSlip", () => {
  it("returns null for an empty list", () => {
    expect(pickLatestDepositSlip([])).toBeNull();
  });

  it("picks the newest depositAt, breaking ties with createdAt", () => {
    const older = slip({
      id: "a",
      depositAt: "2026-07-10T12:00:00.000Z",
      createdAt: "2026-07-10T12:01:00.000Z",
    });
    const newerSameMinuteEarlierCreate = slip({
      id: "b",
      depositAt: "2026-07-11T12:00:00.000Z",
      createdAt: "2026-07-11T12:01:00.000Z",
    });
    const newerSameMinuteLaterCreate = slip({
      id: "c",
      depositAt: "2026-07-11T12:00:00.000Z",
      createdAt: "2026-07-11T12:05:00.000Z",
    });
    expect(
      pickLatestDepositSlip([
        older,
        newerSameMinuteEarlierCreate,
        newerSameMinuteLaterCreate,
      ])?.id,
    ).toBe("c");
  });

  it("ignores invalid depositAt when a valid newer slip exists", () => {
    const invalid = slip({
      id: "bad",
      depositAt: "not-a-date",
      createdAt: "2026-07-12T12:00:00.000Z",
    });
    const valid = slip({
      id: "good",
      depositAt: "2026-07-11T12:00:00.000Z",
      createdAt: "2026-07-11T12:00:00.000Z",
    });
    expect(pickLatestDepositSlip([invalid, valid])?.id).toBe("good");
  });
});
