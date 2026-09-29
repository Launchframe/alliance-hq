import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

import enUS from "../../../messages/en-US.json";
import ptBR from "../../../messages/pt-BR.json";

import { activityCatalog } from "./catalog.shared";
import type { ActivityFeedItem } from "./feed.shared";
import {
  ACTIVITY_FEATURE_LABEL_KEYS,
  ACTIVITY_ROLE_LABEL_KEYS,
  ACTIVITY_TOOL_LABEL_KEYS,
  activityDayStartIso,
  formatActivityNumber,
  formatActivitySentence,
  type ActivityTranslator,
} from "./presentation.shared";
import {
  ACTIVITY_ROLES,
  ACTIVITY_TOOLS,
} from "./types.shared";

const messages = { "en-US": enUS, "pt-BR": ptBR } as const;

function tFor(locale: "en-US" | "pt-BR"): ActivityTranslator {
  const t = createTranslator({ locale, messages: messages[locale] });
  return (key, values) => t(key as never, values as never);
}

function makeItem(overrides: Partial<ActivityFeedItem>): ActivityFeedItem {
  return {
    id: "evt-1",
    occurredAt: "2099-01-15T12:00:00.000000Z",
    eventKey: "thp.submitted",
    feature: "thp",
    kind: "change",
    descriptor: "thpSubmitted",
    resource: null,
    values: {},
    details: {},
    actor: {
      key: "hq:actor-1",
      displayName: "Cmd",
      hqRole: null,
      gameRank: null,
      unlinkedHq: false,
    },
    alliance: null,
    channel: "web",
    method: "manual",
    severity: "update",
    historical: false,
    historicalCurrentLabels: false,
    ...overrides,
  };
}

describe("formatActivityNumber", () => {
  it("formats locale-grouped numbers and preserves 30-digit precision", () => {
    const huge = "123456789012345678901234567890";
    expect(formatActivityNumber(huge, "en-US")).toBe(
      "123,456,789,012,345,678,901,234,567,890",
    );
    expect(formatActivityNumber(huge, "pt-BR")).toBe(
      "123.456.789.012.345.678.901.234.567.890",
    );
    expect(formatActivityNumber("123456789", "en-US")).toBe("123,456,789");
    expect(formatActivityNumber(42, "en-US")).toBe("42");
  });
});

describe("formatActivitySentence", () => {
  it("renders the personal thp example in en-US and pt-BR", () => {
    const item = makeItem({ values: { value: "123456789" } });
    expect(
      formatActivitySentence(item, "personal", "en-US", tFor("en-US")),
    ).toBe("You submitted a new THP of 123,456,789");
    expect(
      formatActivitySentence(item, "personal", "pt-BR", tFor("pt-BR")),
    ).toBe("Você enviou um novo THP de 123.456.789");
  });

  it("renders the alliance promotion example", () => {
    const item = makeItem({
      eventKey: "member.promoted",
      feature: "members",
      descriptor: "promoted",
      values: { member: "Jam", fromRank: "R3", toRank: "R4" },
      actor: {
        key: "hq:redd",
        displayName: "Redd",
        hqRole: "owner",
        gameRank: "R5",
        unlinkedHq: false,
      },
    });
    expect(
      formatActivitySentence(item, "alliance", "en-US", tFor("en-US")),
    ).toBe("Redd promoted Jam from R3 to R4");
    expect(
      formatActivitySentence(item, "alliance", "pt-BR", tFor("pt-BR")),
    ).toBe("Redd promoveu Jam de R3 para R4");
  });

  it("renders the global scores example with server and tag prefix", () => {
    const item = makeItem({
      eventKey: "scores.discarded",
      feature: "scores",
      descriptor: "discarded",
      resource: "vsScores",
      actor: {
        key: "hq:boggle",
        displayName: "BOGGLE",
        hqRole: "officer",
        gameRank: "R4",
        unlinkedHq: false,
      },
      alliance: {
        id: "all-1",
        serverNumber: "1203",
        tag: "LFgo",
        name: "Lifeguard",
      },
    });
    expect(
      formatActivitySentence(item, "global", "en-US", tFor("en-US")),
    ).toBe("1203 [LFgo] BOGGLE discarded VS Performance scores");
    expect(
      formatActivitySentence(item, "global", "pt-BR", tFor("pt-BR")),
    ).toBe(
      "1203 [LFgo] BOGGLE descartou as pontuações de Desempenho VS",
    );
  });

  it("renders huge stat values with locale grouping", () => {
    const item = makeItem({
      values: { value: "123456789012345678901234567890" },
    });
    expect(
      formatActivitySentence(item, "personal", "en-US", tFor("en-US")),
    ).toBe(
      "You submitted a new THP of 123,456,789,012,345,678,901,234,567,890",
    );
  });

  it("falls back to unknown actor copy for missing names", () => {
    const missing = makeItem({
      actor: null,
      values: { member: null, fromRank: "R4", toRank: "R5" },
      eventKey: "member.promoted",
      feature: "members",
      descriptor: "promoted",
    });
    expect(
      formatActivitySentence(missing, "alliance", "en-US", tFor("en-US")),
    ).toBe("Unknown user promoted Unknown user from R4 to R5");
    expect(
      formatActivitySentence(missing, "alliance", "pt-BR", tFor("pt-BR")),
    ).toBe(
      "Usuário desconhecido promoveu Usuário desconhecido de R4 para R5",
    );
  });

  it("localizes HQ roles inside sentences", () => {
    const item = makeItem({
      eventKey: "member.role_changed",
      feature: "members",
      descriptor: "roleChanged",
      values: { member: "Jam", fromRole: "officer", toRole: "member" },
    });
    expect(
      formatActivitySentence(item, "alliance", "en-US", tFor("en-US")),
    ).toBe("Cmd changed Jam’s HQ role from Officer to Member");
    expect(
      formatActivitySentence(item, "alliance", "pt-BR", tFor("pt-BR")),
    ).toBe("Cmd alterou a função HQ de Jam de Oficial para Membro");
  });

  it("uses the no-alliance prefix in global scope and omits unknown parts", () => {
    const base = makeItem({
      eventKey: "scores.discarded",
      feature: "scores",
      descriptor: "discarded",
      resource: "vsScores",
    });
    expect(
      formatActivitySentence(base, "global", "en-US", tFor("en-US")),
    ).toBe("No alliance Cmd discarded VS Performance scores");
    const known = makeItem({
      ...base,
      alliance: {
        id: "all-2",
        serverNumber: null,
        tag: null,
        name: null,
      },
    });
    expect(
      formatActivitySentence(known, "global", "en-US", tFor("en-US")),
    ).toBe("Cmd discarded VS Performance scores");
  });

  it("renders tool.opened through the tool label map", () => {
    const item = makeItem({
      eventKey: "tool.opened",
      feature: "usage",
      kind: "usage",
      descriptor: "opened",
      values: { tool: "trains" },
    });
    expect(
      formatActivitySentence(item, "personal", "en-US", tFor("en-US")),
    ).toBe("You opened Alliance Train");
  });
});

describe("presentation label maps", () => {
  function messageAt(locale: "en-US" | "pt-BR", key: string): unknown {
    let node: unknown = messages[locale];
    for (const segment of key.split(".")) {
      if (node === null || typeof node !== "object") return undefined;
      node = (node as Record<string, unknown>)[segment];
    }
    return node;
  }

  it("covers every catalog feature, tool, and role with real keys in both locales", () => {
    const features = new Set(
      Object.values(activityCatalog).map((entry) => entry.feature),
    );
    const labelKeys = new Set<string>();
    for (const feature of features) {
      const key =
        ACTIVITY_FEATURE_LABEL_KEYS[
          feature as keyof typeof ACTIVITY_FEATURE_LABEL_KEYS
        ];
      expect(key, `feature ${feature}`).toBeTruthy();
      labelKeys.add(key);
    }
    for (const tool of ACTIVITY_TOOLS) {
      expect(ACTIVITY_TOOL_LABEL_KEYS[tool], `tool ${tool}`).toBeTruthy();
      labelKeys.add(ACTIVITY_TOOL_LABEL_KEYS[tool]);
    }
    for (const role of ACTIVITY_ROLES) {
      expect(ACTIVITY_ROLE_LABEL_KEYS[role], `role ${role}`).toBeTruthy();
      labelKeys.add(ACTIVITY_ROLE_LABEL_KEYS[role]);
    }
    for (const key of labelKeys) {
      for (const locale of ["en-US", "pt-BR"] as const) {
        expect(
          typeof messageAt(locale, key),
          `${locale} ${key}`,
        ).toBe("string");
      }
    }
  });
});

describe("activityDayStartIso", () => {
  it("handles the 23-hour spring-forward day in New York", () => {
    const start = activityDayStartIso("2026-03-08", "America/New_York");
    const next = activityDayStartIso("2026-03-09", "America/New_York");
    expect(start).toBe("2026-03-08T05:00:00.000Z");
    expect(next).toBe("2026-03-09T04:00:00.000Z");
    expect(Date.parse(next) - Date.parse(start)).toBe(23 * 60 * 60 * 1000);
  });

  it("handles the 25-hour fall-back day in New York", () => {
    const start = activityDayStartIso("2026-11-01", "America/New_York");
    const next = activityDayStartIso("2026-11-02", "America/New_York");
    expect(start).toBe("2026-11-01T04:00:00.000Z");
    expect(next).toBe("2026-11-02T05:00:00.000Z");
    expect(Date.parse(next) - Date.parse(start)).toBe(25 * 60 * 60 * 1000);
  });

  it("always starts at 02:00Z in game server time", () => {
    expect(activityDayStartIso("2026-03-08", "Etc/GMT+2")).toBe(
      "2026-03-08T02:00:00.000Z",
    );
    expect(activityDayStartIso("2026-11-01", "Etc/GMT+2")).toBe(
      "2026-11-01T02:00:00.000Z",
    );
  });

  it("resolves exact boundaries for early four-digit years", () => {
    expect(activityDayStartIso("0100-01-05", "UTC")).toBe(
      "0100-01-05T00:00:00.000Z",
    );
    expect(activityDayStartIso("0100-12-31", "UTC")).toBe(
      "0100-12-31T00:00:00.000Z",
    );
  });

  it("rejects malformed, year-zero, and impossible dates", () => {
    for (const bad of [
      "2026-02-30",
      "2026-13-01",
      "15-01-2026",
      "0000-01-01",
      "0000-12-31",
      "",
    ]) {
      expect(() => activityDayStartIso(bad, "UTC"), bad).toThrow(
        "invalid_activity_date",
      );
    }
  });
});
