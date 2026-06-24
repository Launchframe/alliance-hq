import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  openOccurrences: [] as unknown[],
}));

vi.mock("@/lib/db", () => {
  const chain = {
    from: () => chain,
    where: () => Promise.resolve(mocks.openOccurrences),
    limit: () => Promise.resolve(mocks.openOccurrences),
    orderBy: () => chain,
  };

  return {
    getDb: () => ({
      select: () => chain,
      update: () => ({
        set: () => ({
          where: () => Promise.resolve(),
        }),
      }),
      insert: () => ({
        values: () => Promise.resolve(),
      }),
    }),
    schema: {
      eurOccurrences: {
        id: "id",
        allianceId: "alliance_id",
        scoreTarget: "score_target",
        scheduledStartAt: "scheduled_start_at",
        status: "status",
      },
      videoJobs: {
        id: "id",
        allianceId: "alliance_id",
        scoreTarget: "score_target",
        status: "status",
        updatedAt: "updated_at",
        createdAt: "created_at",
      },
      inboxReminderItems: {
        eurOccurrenceId: "eur_occurrence_id",
        allianceId: "alliance_id",
        kind: "kind",
        active: "active",
      },
    },
  };
});

import { runEurSatisfactionPass } from "@/lib/eur/satisfaction";

describe("runEurSatisfactionPass", () => {
  beforeEach(() => {
    mocks.openOccurrences = [];
  });

  it("returns zero when no open occurrences", async () => {
    const satisfied = await runEurSatisfactionPass();
    expect(satisfied).toBe(0);
  });
});
