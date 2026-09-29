import { describe, expect, it, vi } from "vitest";

import type { ActivityEventRecord } from "@/lib/db/schema";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireApiSession: vi.fn() }));
vi.mock("@/lib/rbac/context", () => ({ getRbacContext: vi.fn() }));
vi.mock("@/lib/rbac/require-permission", () => ({
  requirePlatformMaintainer: vi.fn(),
  requireSessionPermission: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: vi.fn() }));

import { ActivityReadError, type ActivityPrincipal } from "./access.server";
import { activityCatalog, type ActivityEventKey } from "./catalog.shared";
import {
  projectActivityRecord,
  safeActivityServerNumber,
  safeVisibleName,
} from "./projection.server";

const PRINCIPAL: ActivityPrincipal = {
  hqUserId: "viewer-1",
  sessionId: "session-1",
  currentAllianceId: "alliance-1",
  permissions: new Set(["hq:audit:read"]),
  isPlatformMaintainer: false,
  scopeFence: JSON.stringify(["viewer-1", "alliance-1"]),
};

const MAINTAINER: ActivityPrincipal = {
  hqUserId: "maintainer-1",
  sessionId: "session-9",
  currentAllianceId: null,
  permissions: new Set(["hq:admin"]),
  isPlatformMaintainer: true,
  scopeFence: JSON.stringify(["maintainer-1", null]),
};

const PERSONAL_OWNER: ActivityPrincipal = {
  hqUserId: "actor-1",
  sessionId: "session-2",
  currentAllianceId: null,
  permissions: new Set<string>(),
  isPlatformMaintainer: false,
  scopeFence: JSON.stringify(["actor-1", null]),
};

const SECRET_UID = "1234567890123456";
const SECRET_EMAIL = "private@e2e.test";

function makeRow(overrides: Partial<ActivityEventRecord> = {}) {
  return {
    id: "evt-fixture-1",
    schemaVersion: 1,
    eventKey: "thp.submitted",
    feature: "thp",
    kind: "change",
    occurredAt: "2026-09-29T12:00:00.123456Z",
    recordedAt: "2026-09-29T12:00:01Z",
    allianceId: "alliance-1",
    actorKind: "hq",
    originalHqUserId: "actor-1",
    originalDiscordUserId: null,
    personalOwnerHqUserId: "actor-1",
    actorCommanderId: null,
    actorDisplayName: "Cmdr Actor",
    actorHqRole: "officer",
    actorGameRank: "R4",
    serverNumber: "1203",
    allianceTag: "TST",
    allianceName: "Test Alliance",
    channel: "web",
    method: "manual",
    severity: "update",
    visibilityClass: "alliance",
    resourceKind: "member",
    resourceId: "secret-resource-id",
    payload: { value: "123456789012345678901234567890" },
    sourceNamespace: "e2e-secret-namespace",
    sourceKey: "e2e-secret-source-key",
    contentHash: "e2e-secret-content-hash",
    historical: false,
    historicalCurrentLabels: false,
    ...overrides,
  } as ActivityEventRecord;
}

function invalidRecord(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ActivityReadError);
    expect((error as ActivityReadError).code).toBe("invalid_record");
    return;
  }
  throw new Error("expected invalid_record");
}

describe("projectActivityRecord", () => {
  it("projects every registered event with a valid payload", () => {
    const payloads: Record<ActivityEventKey, ActivityEventRecord["payload"]> = {
      "thp.submitted": { value: "123456789012345678901234567890" },
      "vr.submitted": { value: "42" },
      "kills.submitted": { value: "7" },
      "member.promoted": { member: "Cmdr One", fromRank: "R2", toRank: "R4" },
      "member.demoted": { member: "Cmdr One", fromRank: "R4", toRank: "R2" },
      "member.rank_set": { member: "Cmdr One", rank: "R3" },
      "member.rank_cleared": { member: "Cmdr One" },
      "member.role_changed": {
        member: "Cmdr One",
        fromRole: "member",
        toRole: "officer",
      },
      "scores.discarded": { affected: 5, completed: 3 },
      "note.updated": {},
      "account.email_changed": {},
      "account.merged": {},
      "tool.opened": { tool: "thp" },
    };

    for (const [eventKey, entry] of Object.entries(activityCatalog)) {
      const row = makeRow({
        eventKey,
        feature: entry.feature,
        kind: entry.kind,
        visibilityClass: entry.visibility,
        payload: payloads[eventKey as ActivityEventKey],
      });
      const item = projectActivityRecord(row, MAINTAINER, "global");
      expect(item.eventKey).toBe(eventKey);
      expect(item.feature).toBe(entry.feature);
      expect(item.kind).toBe(entry.kind);
      expect(item.descriptor).toBe(entry.descriptor);
      expect(item.resource).toBe(entry.resource);
    }
  });

  it("denies out-of-scope and foreign rows before reading payloads", () => {
    const privateRow = makeRow({
      eventKey: "note.updated",
      feature: "notes",
      kind: "change",
      visibilityClass: "private",
      payload: {},
    });
    const forbidden = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        expect(error).toBeInstanceOf(ActivityReadError);
        expect((error as ActivityReadError).code).toBe("forbidden");
        expect((error as ActivityReadError).status).toBe(403);
        return;
      }
      throw new Error("expected forbidden");
    };

    forbidden(() => projectActivityRecord(privateRow, PRINCIPAL, "alliance"));
    forbidden(() =>
      projectActivityRecord(
        makeRow({ allianceId: "other-tenant" }),
        PRINCIPAL,
        "alliance",
      ),
    );
    forbidden(() =>
      projectActivityRecord(
        makeRow({ personalOwnerHqUserId: "other" }),
        PERSONAL_OWNER,
        "personal",
      ),
    );
    forbidden(() => projectActivityRecord(makeRow(), PRINCIPAL, "global"));
    forbidden(() => projectActivityRecord(makeRow(), PRINCIPAL, "personal"));
  });

  it("keeps stat values as exact strings", () => {
    const item = projectActivityRecord(makeRow(), PRINCIPAL, "alliance");
    expect(item.values.value).toBe("123456789012345678901234567890");
  });

  it("copies rank, role, and tool values from the validated payload", () => {
    const item = projectActivityRecord(
      makeRow({
        eventKey: "member.role_changed",
        feature: "members",
        kind: "change",
        visibilityClass: "alliance",
        payload: {
          member: "Cmdr One",
          fromRole: "member",
          toRole: "officer",
        },
      }),
      PRINCIPAL,
      "alliance",
    );
    expect(item.values.member).toBe("Cmdr One");
    expect(item.values.fromRole).toBe("member");
    expect(item.values.toRole).toBe("officer");
  });

  it("exposes approved numeric details on alliance scope", () => {
    const item = projectActivityRecord(
      makeRow({
        eventKey: "scores.discarded",
        feature: "scores",
        kind: "change",
        visibilityClass: "alliance",
        payload: { affected: 5, completed: 3 },
      }),
      PRINCIPAL,
      "alliance",
    );
    expect(item.details).toEqual({ affected: 5, completed: 3 });
  });

  it("hides the actor and details on personal scope", () => {
    const item = projectActivityRecord(
      makeRow({
        eventKey: "scores.discarded",
        feature: "scores",
        kind: "change",
        visibilityClass: "alliance",
        payload: { affected: 5, completed: 3 },
      }),
      PERSONAL_OWNER,
      "personal",
    );
    expect(item.actor).toBeNull();
    expect(item.details).toEqual({});
    expect(item.descriptor).toBe("discarded");
  });

  it("derives the actor filter key from original identity", () => {
    const hq = projectActivityRecord(makeRow(), PRINCIPAL, "alliance");
    expect(hq.actor!.key).toBe("hq:actor-1");
    expect(hq.actor!.unlinkedHq).toBe(false);

    const discord = projectActivityRecord(
      makeRow({
        actorKind: "discord",
        originalHqUserId: null,
        originalDiscordUserId: "discord-user-9",
        personalOwnerHqUserId: null,
      }),
      PRINCIPAL,
      "alliance",
    );
    expect(discord.actor!.key).toBe("discord:discord-user-9");
    expect(discord.actor!.unlinkedHq).toBe(true);
  });

  it("rejects rows with sensitive extra payload fields", () => {
    invalidRecord(() =>
      projectActivityRecord(
        makeRow({
          payload: {
            value: "1",
            gameUid: SECRET_UID,
            email: SECRET_EMAIL,
          } as ActivityEventRecord["payload"],
        }),
        MAINTAINER,
        "global",
      ),
    );
  });

  it("omits resourceId even on private rows for maintainers", () => {
    const item = projectActivityRecord(
      makeRow({
        eventKey: "note.updated",
        feature: "notes",
        kind: "change",
        visibilityClass: "private",
        resourceKind: "member",
        resourceId: "private-member-row-id",
        payload: {},
      }),
      MAINTAINER,
      "global",
    );
    const json = JSON.stringify(item);
    expect(json).not.toContain("private-member-row-id");
    expect(json).not.toContain("e2e-secret-source-key");
    expect(json).not.toContain("e2e-secret-namespace");
    expect(json).not.toContain("e2e-secret-content-hash");
    expect(json).not.toContain(SECRET_UID);
    expect(json).not.toContain(SECRET_EMAIL);
    expect(item.values).toEqual({});
  });

  it("drops email-shaped and UID-shaped labels instead of rendering them", () => {
    const item = projectActivityRecord(
      makeRow({
        actorDisplayName: SECRET_EMAIL,
        allianceName: SECRET_UID,
        allianceTag: "TST",
        payload: { value: "1" },
      }),
      PRINCIPAL,
      "alliance",
    );
    expect(item.actor!.displayName).toBeNull();
    expect(item.alliance!.name).toBeNull();
    expect(item.alliance!.tag).toBe("TST");
    expect(JSON.stringify(item)).not.toContain(SECRET_EMAIL);
    expect(JSON.stringify(item)).not.toContain(SECRET_UID);
  });

  it("drops unsafe member payload names", () => {
    const item = projectActivityRecord(
      makeRow({
        eventKey: "member.rank_set",
        feature: "members",
        kind: "change",
        visibilityClass: "alliance",
        payload: { member: SECRET_EMAIL, rank: "R3" },
      }),
      PRINCIPAL,
      "alliance",
    );
    expect(item.values.member).toBeNull();
  });

  it("rejects rows whose registry mapping does not match", () => {
    invalidRecord(() =>
      projectActivityRecord(
        makeRow({ feature: "vr" }),
        PRINCIPAL,
        "alliance",
      ),
    );
    invalidRecord(() =>
      projectActivityRecord(
        makeRow({ kind: "usage" }),
        PRINCIPAL,
        "alliance",
      ),
    );
  });

  it("rejects unknown schema versions, event keys, and enum values", () => {
    invalidRecord(() =>
      projectActivityRecord(makeRow({ schemaVersion: 2 }), PRINCIPAL, "alliance"),
    );
    invalidRecord(() =>
      projectActivityRecord(
        makeRow({ eventKey: "not.registered" }),
        PRINCIPAL,
        "alliance",
      ),
    );
    invalidRecord(() =>
      projectActivityRecord(makeRow({ severity: "bogus" }), PRINCIPAL, "alliance"),
    );
    invalidRecord(() =>
      projectActivityRecord(
        makeRow({ actorGameRank: "R9" }),
        PRINCIPAL,
        "alliance",
      ),
    );
    invalidRecord(() =>
      projectActivityRecord(
        makeRow({ channel: "pigeon" }),
        PRINCIPAL,
        "alliance",
      ),
    );
  });
});

describe("safeVisibleName", () => {
  it("trims and bounds labels", () => {
    expect(safeVisibleName("  Cmdr One  ")).toBe("Cmdr One");
    expect(safeVisibleName("x".repeat(200))).toHaveLength(160);
  });

  it("rejects emails, UID-like sequences, and non-strings", () => {
    expect(safeVisibleName(SECRET_EMAIL)).toBeNull();
    expect(safeVisibleName(SECRET_UID)).toBeNull();
    expect(safeVisibleName(`Cmdr ${SECRET_UID}`)).toBeNull();
    expect(safeVisibleName(`${SECRET_UID} squad`)).toBeNull();
    expect(safeVisibleName("")).toBeNull();
    expect(safeVisibleName(null)).toBeNull();
    expect(safeVisibleName(42)).toBeNull();
    expect(safeVisibleName("LFgo TST")).toBe("LFgo TST");
    expect(safeVisibleName("Server 1203 crew")).toBe("Server 1203 crew");
  });
});

describe("safeActivityServerNumber", () => {
  it("accepts digit-only server numbers and rejects the rest", () => {
    expect(safeActivityServerNumber("1203")).toBe("1203");
    expect(safeActivityServerNumber("12345678")).toBe("12345678");
    expect(safeActivityServerNumber("123456789")).toBeNull();
    expect(safeActivityServerNumber("12a3")).toBeNull();
    expect(safeActivityServerNumber(SECRET_UID)).toBeNull();
    expect(safeActivityServerNumber(" private ")).toBeNull();
    expect(safeActivityServerNumber(null)).toBeNull();
  });
});
