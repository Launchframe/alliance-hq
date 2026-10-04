import { describe, expect, it } from "vitest";

import enUS from "../../../messages/en-US.json";
import ptBR from "../../../messages/pt-BR.json";

import {
  activityCatalog,
  isActivityEventKey,
  parseActivityEvent,
  type ActivityEventKey,
} from "./catalog.shared";
import { ACTIVITY_RESOURCE_KEYS } from "./types.shared";

const hqActor = {
  kind: "hq",
  hqUserId: "hq-user-1",
  discordUserId: null,
  personalOwnerHqUserId: "hq-user-1",
  commanderId: null,
  displayName: "Commander One",
  hqRole: "officer",
  gameRank: "R4",
};

const discordActor = {
  kind: "discord",
  hqUserId: null,
  discordUserId: "discord-1",
  personalOwnerHqUserId: null,
  commanderId: null,
  displayName: "Cmd",
  hqRole: null,
  gameRank: "R5",
};

const unattributedActor = (kind: "automation" | "unknown") => ({
  kind,
  hqUserId: null,
  discordUserId: null,
  personalOwnerHqUserId: null,
  commanderId: null,
  displayName: null,
  hqRole: null,
  gameRank: null,
});

const scope = {
  allianceId: "alliance-1",
  serverNumber: "1234",
  allianceTag: "LFgo",
  allianceName: "Launchframe",
};

const baseInput = {
  actor: hqActor,
  scope,
  channel: "web",
  method: "manual",
  occurredAt: new Date("2026-09-29T12:00:00.000Z"),
  source: { namespace: "test-suite", key: "source-1" },
  severity: "update",
};

const minimalPayloads: Record<ActivityEventKey, Record<string, unknown>> = {
  "thp.submitted": { value: "123" },
  "vr.submitted": { value: "456" },
  "kills.submitted": { value: "789" },
  "member.promoted": { member: "Bob", fromRank: "R2", toRank: "R4" },
  "member.demoted": { member: "Bob", fromRank: "R4", toRank: "R2" },
  "member.rank_set": { member: "Bob", rank: "R3" },
  "member.rank_cleared": { member: "Bob" },
  "member.role_changed": {
    member: "Bob",
    fromRole: "member",
    toRole: "officer",
  },
  "member.weekly_pass_updated": {},
  "scores.discarded": { affected: 3, completed: 2 },
  "note.updated": {},
  "account.email_changed": {},
  "account.merged": {},
  "tool.opened": { tool: "thp" },
};

function inputFor(
  eventKey: ActivityEventKey,
  overrides: Record<string, unknown> = {},
) {
  return {
    ...baseInput,
    eventKey,
    payload: minimalPayloads[eventKey],
    ...overrides,
  };
}

describe("activityCatalog", () => {
  it("is a closed registry of settled event keys", () => {
    expect(Object.keys(activityCatalog).sort()).toEqual(
      [
        "account.email_changed",
        "account.merged",
        "kills.submitted",
        "member.demoted",
        "member.promoted",
        "member.rank_cleared",
        "member.rank_set",
        "member.role_changed",
        "member.weekly_pass_updated",
        "note.updated",
        "scores.discarded",
        "thp.submitted",
        "tool.opened",
        "vr.submitted",
      ].sort(),
    );
    expect(isActivityEventKey("thp.submitted")).toBe(true);
    expect(isActivityEventKey("audit.login")).toBe(false);
  });

  it.each([
    ["en-US", enUS],
    ["pt-BR", ptBR],
  ] as const)(
    "has non-empty %s translations for every descriptor and resource",
    (_locale, messages) => {
      const events = messages.activity.events as Record<string, string>;
      const resources = messages.activity.resources as Record<string, string>;
      for (const entry of Object.values(activityCatalog)) {
        expect(events[entry.descriptor]?.length).toBeGreaterThan(0);
        if (entry.resource !== null) {
          expect(resources[entry.resource]?.length).toBeGreaterThan(0);
        }
      }
      expect(Object.keys(resources).sort()).toEqual(
        [...ACTIVITY_RESOURCE_KEYS].sort(),
      );
    },
  );
});

describe("parseActivityEvent", () => {
  it.each(Object.keys(activityCatalog) as ActivityEventKey[])(
    "accepts a minimal valid input for %s",
    (eventKey) => {
      const result = parseActivityEvent(inputFor(eventKey));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.eventKey).toBe(eventKey);
        expect(result.data.historical).toBe(false);
        expect(result.data.historicalCurrentLabels).toBe(false);
      }
    },
  );

  it("rejects an unknown event key", () => {
    const result = parseActivityEvent(
      inputFor("thp.submitted", { eventKey: "member.exploded" }),
    );
    expect(result.success).toBe(false);
  });

  it.each(["gameUid", "email", "title", "token"])(
    "rejects extra payload field %s",
    (field) => {
      const result = parseActivityEvent(
        inputFor("thp.submitted", {
          payload: { value: "123", [field]: "secret" },
        }),
      );
      expect(result.success).toBe(false);
    },
  );

  it.each(["active", "source", "ashedMemberId", "commanderId"])(
    "rejects arbitrary payload field %s on weekly pass updates",
    (field) => {
      const result = parseActivityEvent(
        inputFor("member.weekly_pass_updated", {
          payload: { [field]: "x" },
        }),
      );
      expect(result.success).toBe(false);
    },
  );

  it("rejects extra envelope, actor, scope, and source keys", () => {
    expect(
      parseActivityEvent(inputFor("thp.submitted", { metadata: {} })).success,
    ).toBe(false);
    expect(
      parseActivityEvent(
        inputFor("thp.submitted", {
          actor: { ...hqActor, email: "a@b.c" },
        }),
      ).success,
    ).toBe(false);
    expect(
      parseActivityEvent(
        inputFor("thp.submitted", {
          scope: { ...scope, gameUid: "123456789012" },
        }),
      ).success,
    ).toBe(false);
    expect(
      parseActivityEvent(
        inputFor("thp.submitted", {
          source: { namespace: "test-suite", key: "source-1", extra: 1 },
        }),
      ).success,
    ).toBe(false);
  });

  it("retains a huge canonical stat value exactly", () => {
    const value = "123456789012345678901234567890";
    const result = parseActivityEvent(
      inputFor("thp.submitted", { payload: { value } }),
    );
    expect(result.success).toBe(true);
    if (result.success && result.data.eventKey === "thp.submitted") {
      expect(result.data.payload.value).toBe(value);
    }
  });

  it.each(["0123", "-1", "12.5", "abc", "1234567890123456789012345678901"])(
    "rejects non-canonical stat value %s",
    (value) => {
      expect(
        parseActivityEvent(inputFor("vr.submitted", { payload: { value } }))
          .success,
      ).toBe(false);
    },
  );

  it("accepts a Date and a strict six-digit UTC occurredAt", () => {
    expect(
      parseActivityEvent(
        inputFor("thp.submitted", {
          occurredAt: new Date("2026-09-29T12:00:00.123Z"),
        }),
      ).success,
    ).toBe(true);
    expect(
      parseActivityEvent(
        inputFor("thp.submitted", {
          occurredAt: "2026-09-29T12:00:00.123456Z",
        }),
      ).success,
    ).toBe(true);
  });

  it.each([
    "2026-09-29T12:00:00.123Z",
    "2026-09-29T12:00:00Z",
    "2026-02-30T12:00:00.123456Z",
    "2026-09-29T12:00:00.123456+02:00",
    "not-a-date",
  ])("rejects occurredAt %s outside the strict contract", (occurredAt) => {
    expect(
      parseActivityEvent(inputFor("thp.submitted", { occurredAt })).success,
    ).toBe(false);
  });

  it("accepts a nullable previousValue", () => {
    const result = parseActivityEvent(
      inputFor("kills.submitted", {
        payload: { value: "5", previousValue: null },
      }),
    );
    expect(result.success).toBe(true);
  });

  it.each([
    { fromRank: "R4", toRank: "R2" },
    { fromRank: "R3", toRank: "R3" },
  ])("rejects invalid promotion direction %o", (ranks) => {
    expect(
      parseActivityEvent(
        inputFor("member.promoted", {
          payload: { member: "Bob", ...ranks },
        }),
      ).success,
    ).toBe(false);
  });

  it.each([
    { fromRank: "R1", toRank: "R5" },
    { fromRank: "R2", toRank: "R2" },
  ])("rejects invalid demotion direction %o", (ranks) => {
    expect(
      parseActivityEvent(
        inputFor("member.demoted", {
          payload: { member: "Bob", ...ranks },
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects completed greater than affected", () => {
    expect(
      parseActivityEvent(
        inputFor("scores.discarded", {
          payload: { affected: 2, completed: 3 },
        }),
      ).success,
    ).toBe(false);
  });

  it("accepts completed equal to affected", () => {
    expect(
      parseActivityEvent(
        inputFor("scores.discarded", {
          payload: { affected: 4, completed: 4 },
        }),
      ).success,
    ).toBe(true);
  });

  it.each([
    { affected: -1, completed: 0 },
    { affected: 1.5, completed: 1 },
    { affected: Number.MAX_SAFE_INTEGER + 1, completed: 0 },
  ])("rejects unsafe discard counts %o", (payload) => {
    expect(
      parseActivityEvent(inputFor("scores.discarded", { payload })).success,
    ).toBe(false);
  });

  it("rejects a live unknown actor", () => {
    const result = parseActivityEvent(
      inputFor("thp.submitted", {
        actor: unattributedActor("unknown"),
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a live unknown actor even over the automation channel", () => {
    const result = parseActivityEvent(
      inputFor("thp.submitted", {
        actor: unattributedActor("unknown"),
        channel: "automation",
      }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts an unknown actor only when historical", () => {
    const result = parseActivityEvent(
      inputFor("thp.submitted", {
        actor: unattributedActor("unknown"),
        historical: true,
      }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects a live unknown channel", () => {
    const result = parseActivityEvent(
      inputFor("thp.submitted", { channel: null }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts unknown channel when historical", () => {
    const result = parseActivityEvent(
      inputFor("thp.submitted", { channel: null, historical: true }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts a null channel for an automation actor", () => {
    const result = parseActivityEvent(
      inputFor("thp.submitted", {
        channel: null,
        actor: unattributedActor("automation"),
      }),
    );
    expect(result.success).toBe(true);
  });

  it.each(["automation", "unknown"] as const)(
    "rejects an %s actor carrying identity or rank",
    (kind) => {
      for (const identity of [
        { hqUserId: "hq-1" },
        { discordUserId: "discord-1" },
        { personalOwnerHqUserId: "hq-1" },
        { commanderId: "commander-1" },
        { hqRole: "member" },
        { gameRank: "R5" },
      ]) {
        expect(
          parseActivityEvent(
            inputFor("thp.submitted", {
              actor: { ...unattributedActor(kind), ...identity },
              historical: true,
            }),
          ).success,
        ).toBe(false);
      }
    },
  );

  it("rejects an hq role without an hq identity", () => {
    expect(
      parseActivityEvent(
        inputFor("thp.submitted", {
          actor: { ...discordActor, hqRole: "member" },
          channel: "discord",
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects a discord actor whose personal owner differs from its hq identity", () => {
    expect(
      parseActivityEvent(
        inputFor("thp.submitted", {
          actor: {
            ...discordActor,
            hqUserId: "hq-user-1",
            personalOwnerHqUserId: "hq-other",
          },
          channel: "discord",
        }),
      ).success,
    ).toBe(false);
    expect(
      parseActivityEvent(
        inputFor("thp.submitted", {
          actor: {
            ...discordActor,
            hqUserId: null,
            personalOwnerHqUserId: "hq-user-1",
          },
          channel: "discord",
        }),
      ).success,
    ).toBe(false);
  });

  it("requires historicalCurrentLabels only on historical events", () => {
    expect(
      parseActivityEvent(
        inputFor("thp.submitted", { historicalCurrentLabels: true }),
      ).success,
    ).toBe(false);
    expect(
      parseActivityEvent(
        inputFor("thp.submitted", {
          historical: true,
          historicalCurrentLabels: true,
        }),
      ).success,
    ).toBe(true);
  });

  it("rejects resourceId on private events", () => {
    expect(
      parseActivityEvent(
        inputFor("note.updated", { resourceId: "note-123" }),
      ).success,
    ).toBe(false);
    expect(
      parseActivityEvent(
        inputFor("account.merged", { resourceId: "user-9" }),
      ).success,
    ).toBe(false);
  });

  it("rejects an alliance event without scope.allianceId", () => {
    const result = parseActivityEvent(
      inputFor("thp.submitted", {
        scope: { ...scope, allianceId: null },
      }),
    );
    expect(result.success).toBe(false);
  });

  it("keeps HQ role and game rank as distinct validated fields", () => {
    expect(
      parseActivityEvent(
        inputFor("thp.submitted", {
          actor: { ...hqActor, gameRank: "officer" },
        }),
      ).success,
    ).toBe(false);
    expect(
      parseActivityEvent(
        inputFor("thp.submitted", {
          actor: { ...hqActor, hqRole: "R3" },
        }),
      ).success,
    ).toBe(false);
  });

  it("requires hq actors to carry a matching hqUserId and personal owner", () => {
    expect(
      parseActivityEvent(
        inputFor("thp.submitted", {
          actor: { ...hqActor, hqUserId: null },
        }),
      ).success,
    ).toBe(false);
    expect(
      parseActivityEvent(
        inputFor("thp.submitted", {
          actor: { ...hqActor, personalOwnerHqUserId: "hq-other" },
        }),
      ).success,
    ).toBe(false);
  });

  it("requires discord actors to carry a discord id with nullable HQ owner", () => {
    expect(
      parseActivityEvent(
        inputFor("thp.submitted", { actor: discordActor, channel: "discord" }),
      ).success,
    ).toBe(true);
    expect(
      parseActivityEvent(
        inputFor("thp.submitted", {
          actor: { ...discordActor, discordUserId: null },
          channel: "discord",
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects email-shaped and oversized identifiers", () => {
    expect(
      parseActivityEvent(
        inputFor("thp.submitted", {
          actor: {
            ...hqActor,
            hqUserId: "user@example.com",
            personalOwnerHqUserId: "user@example.com",
          },
        }),
      ).success,
    ).toBe(false);
    expect(
      parseActivityEvent(
        inputFor("thp.submitted", { resourceId: "x".repeat(201) }),
      ).success,
    ).toBe(false);
  });
});
