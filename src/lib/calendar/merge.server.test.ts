import { getTableName } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { applyCalendarMergeRemap } from "./merge.server";

vi.mock("./repository.server", () => ({
  lockCalendarUser: vi.fn().mockResolvedValue(undefined),
  lockCalendarTarget: vi.fn().mockResolvedValue(undefined),
}));

type Write =
  | { kind: "update"; table: string; id: string; set: Record<string, unknown> }
  | { kind: "delete"; table: string; id: string };

function whereParamValue(condition: unknown): string {
  const chunks = (condition as { queryChunks: unknown[] }).queryChunks;
  const param = chunks.find(
    (chunk) =>
      chunk !== null &&
      typeof chunk === "object" &&
      (chunk as { constructor: { name: string } }).constructor.name ===
        "Param",
  ) as { value: string } | undefined;
  if (!param) throw new Error("expected eq(..., value) condition");
  return param.value;
}

function tableName(table: unknown): string {
  return getTableName(table as Parameters<typeof getTableName>[0]);
}

function mergeTx() {
  const writes: Write[] = [];
  const tx = {
    execute: vi.fn().mockResolvedValue(undefined),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((set: Record<string, unknown>) => ({
        where: vi.fn(async (condition: unknown) => {
          writes.push({
            kind: "update",
            table: tableName(table),
            id: whereParamValue(condition),
            set,
          });
        }),
      })),
    })),
    delete: vi.fn((table: unknown) => ({
      where: vi.fn(async (condition: unknown) => {
        writes.push({
          kind: "delete",
          table: tableName(table),
          id: whereParamValue(condition),
        });
      }),
    })),
  };
  return { tx: tx as never, writes };
}

function account(partial: {
  id: string;
  hqUserId: string;
}): typeof import("@/lib/db").schema.calendarAccounts.$inferSelect {
  return {
    id: partial.id,
    hqUserId: partial.hqUserId,
    subject: "sub",
    email: `${partial.hqUserId}@example.test`,
    refreshToken: "enc-refresh",
    accessToken: null,
    refreshLeaseToken: null,
    refreshLeaseUntil: null,
    expiresAt: null,
    status: "connected",
    version: 1,
    updatedAt: new Date("2026-10-12T00:00:00.000Z"),
  };
}

function target(partial: {
  id: string;
  hqUserId: string;
  allianceId: string;
  provider?: string;
  accountId?: string | null;
  enabled?: boolean;
  generation?: number;
  status?: string;
  remoteCalendarId?: string | null;
}): typeof import("@/lib/db").schema.calendarTargets.$inferSelect {
  return {
    id: partial.id,
    hqUserId: partial.hqUserId,
    allianceId: partial.allianceId,
    provider: partial.provider ?? "google",
    sources: ["boarding"],
    enabled: partial.enabled ?? true,
    version: 1,
    generation: partial.generation ?? 1,
    scanCursor: 0,
    creationUncertain: false,
    feedHash: null,
    feedSecret: null,
    remoteCalendarId: partial.remoteCalendarId ?? "remote",
    accountId: partial.accountId ?? null,
    status: partial.status ?? "synced",
    cleanup: false,
    leaseToken: null,
    leaseUntil: null,
    nextSyncAt: new Date("2026-10-12T00:00:00.000Z"),
    lastSyncAt: null,
    lastFetchAt: null,
    failureCount: 0,
  };
}

describe("applyCalendarMergeRemap", () => {
  it("moves Google account + target when only the source user is connected", async () => {
    const { tx, writes } = mergeTx();

    await applyCalendarMergeRemap(tx, {
      sourceId: "source",
      canonicalId: "canonical",
      prefs: [{ hqUserId: "source" }],
      sourceOauthCount: 1,
      accounts: [account({ id: "acct-source", hqUserId: "source" })],
      targets: [
        target({
          id: "target-1",
          hqUserId: "source",
          allianceId: "alliance-1",
          accountId: "acct-source",
          generation: 2,
        }),
      ],
    });

    expect(writes).toEqual([
      {
        kind: "update",
        table: "calendar_preferences",
        id: "source",
        set: { hqUserId: "canonical" },
      },
      {
        kind: "delete",
        table: "calendar_oauth_states",
        id: "source",
      },
      {
        kind: "update",
        table: "calendar_targets",
        id: "target-1",
        set: expect.objectContaining({
          hqUserId: "canonical",
          accountId: "acct-source",
          status: "pending",
          generation: 3,
        }),
      },
      {
        kind: "update",
        table: "calendar_accounts",
        id: "acct-source",
        set: expect.objectContaining({ hqUserId: "canonical" }),
      },
    ]);
  });

  it("keeps the canonical Google account and drops a conflicting source target", async () => {
    const { tx, writes } = mergeTx();

    await applyCalendarMergeRemap(tx, {
      sourceId: "source",
      canonicalId: "canonical",
      prefs: [{ hqUserId: "source" }, { hqUserId: "canonical" }],
      sourceOauthCount: 0,
      accounts: [
        account({ id: "acct-source", hqUserId: "source" }),
        account({ id: "acct-canonical", hqUserId: "canonical" }),
      ],
      targets: [
        target({
          id: "target-source",
          hqUserId: "source",
          allianceId: "alliance-1",
          accountId: "acct-source",
        }),
        target({
          id: "target-canonical",
          hqUserId: "canonical",
          allianceId: "alliance-1",
          accountId: "acct-canonical",
        }),
      ],
    });

    expect(writes).toEqual([
      {
        kind: "delete",
        table: "calendar_preferences",
        id: "source",
      },
      {
        kind: "delete",
        table: "calendar_targets",
        id: "target-source",
      },
      {
        kind: "delete",
        table: "calendar_accounts",
        id: "acct-source",
      },
    ]);
  });

  it("rebinds a non-conflicting source Google target onto the canonical account", async () => {
    const { tx, writes } = mergeTx();

    await applyCalendarMergeRemap(tx, {
      sourceId: "source",
      canonicalId: "canonical",
      prefs: [],
      sourceOauthCount: 0,
      accounts: [
        account({ id: "acct-source", hqUserId: "source" }),
        account({ id: "acct-canonical", hqUserId: "canonical" }),
      ],
      targets: [
        target({
          id: "target-source",
          hqUserId: "source",
          allianceId: "alliance-2",
          accountId: "acct-source",
          remoteCalendarId: "remote-source",
        }),
      ],
    });

    expect(writes).toEqual([
      {
        kind: "update",
        table: "calendar_targets",
        id: "target-source",
        set: expect.objectContaining({
          hqUserId: "canonical",
          accountId: "acct-canonical",
          remoteCalendarId: null,
          leaseToken: null,
          status: "pending",
          generation: 2,
        }),
      },
      {
        kind: "update",
        table: "calendar_entries",
        id: "target-source",
        set: {
          remoteId: null,
          appliedRevision: 0,
          uncertain: false,
          remoteConfirmed: false,
        },
      },
      {
        kind: "delete",
        table: "calendar_accounts",
        id: "acct-source",
      },
    ]);
  });
});
