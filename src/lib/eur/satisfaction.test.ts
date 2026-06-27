import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  openOccurrences: [] as unknown[],
  reminderItems: [] as Array<{ id: string; allianceId: string }>,
  dismissalsInserted: false,
}));

vi.mock("@/lib/db", () => {
  const chain: PromiseLike<unknown[]> & {
    from: () => typeof chain;
    where: () => typeof chain;
    orderBy: () => typeof chain;
    limit: () => Promise<unknown[]>;
  } = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(mocks.reminderItems),
    then(onFulfilled, onRejected) {
      return Promise.resolve(mocks.openOccurrences).then(onFulfilled, onRejected);
    },
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
        values: () => ({
          onConflictDoNothing: () => {
            mocks.dismissalsInserted = true;
            return Promise.resolve();
          },
        }),
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
        id: "id",
        allianceId: "alliance_id",
        eurOccurrenceId: "eur_occurrence_id",
        kind: "kind",
        active: "active",
      },
      inboxReminderDismissals: {
        hqUserId: "hq_user_id",
        itemId: "item_id",
      },
    },
  };
});

import {
  dismissReminderItemForAlliance,
  runEurSatisfactionPass,
} from "@/lib/eur/satisfaction";

describe("runEurSatisfactionPass", () => {
  beforeEach(() => {
    mocks.openOccurrences = [];
    mocks.reminderItems = [];
    mocks.dismissalsInserted = false;
  });

  it("returns zero when no open occurrences", async () => {
    const satisfied = await runEurSatisfactionPass();
    expect(satisfied).toBe(0);
  });
});

describe("dismissReminderItemForAlliance", () => {
  beforeEach(() => {
    mocks.reminderItems = [];
    mocks.dismissalsInserted = false;
  });

  it("returns false when item is not in alliance", async () => {
    mocks.reminderItems = [];
    const ok = await dismissReminderItemForAlliance("user-1", "item-1", "ally-a");
    expect(ok).toBe(false);
    expect(mocks.dismissalsInserted).toBe(false);
  });

  it("dismisses when item belongs to alliance", async () => {
    mocks.reminderItems = [{ id: "item-1", allianceId: "ally-a" }];
    const ok = await dismissReminderItemForAlliance("user-1", "item-1", "ally-a");
    expect(ok).toBe(true);
    expect(mocks.dismissalsInserted).toBe(true);
  });
});
