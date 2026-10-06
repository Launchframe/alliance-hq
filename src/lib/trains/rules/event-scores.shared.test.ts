import { describe, expect, it } from "vitest";

import {
  conductorRuleIdentity,
  conductorRuleLabelKey,
  eventUnboundLabelKey,
  conductorRuleSchema,
  parseConductorRule,
  parseVipRule,
  vipRuleIdentity,
  vipRuleLabelKey,
  vipRuleSchema,
  type EventScoresRule,
} from "@/lib/trains/rules/catalog.shared";
import {
  canSpinVipForRule,
  conductorRuleNeedsWheel,
  conductorRulePoolType,
  spinSourceForConductorRule,
  spinSourceForVipRule,
  vipRulePoolType,
} from "@/lib/trains/rules/derive.shared";
import {
  decodeConductorRule,
  decodeVipRule,
  encodeLegacyConductorMechanism,
  encodeLegacyVipMechanism,
} from "@/lib/trains/rules/encode.shared";
import { paletteIdForRule } from "@/lib/trains/rules/palette.shared";
import {
  CONDUCTOR_MECHANISMS,
  VIP_MECHANISMS,
} from "@/lib/trains/types";

const warzoneSource = {
  target: "warzone-duel",
  seriesId: "s1",
  occurrenceId: "ev-2026-09-19",
  boardKey: null,
  teamScope: null,
} as const;

function rule(partial: Partial<EventScoresRule> = {}): EventScoresRule {
  return {
    kind: "event_scores",
    source: { ...warzoneSource },
    eligibility: "scored",
    topN: 10,
    fallback: "none",
    ...partial,
  };
}

describe("event_scores schema", () => {
  it("accepts a fully bound scored Warzone conductor rule", () => {
    expect(conductorRuleSchema.safeParse(rule()).success).toBe(true);
    expect(vipRuleSchema.safeParse(rule()).success).toBe(true);
  });

  it("accepts unbound template intent (null source ids)", () => {
    const unbound = rule({
      source: {
        target: "warzone-duel",
        seriesId: null,
        occurrenceId: null,
        boardKey: null,
        teamScope: null,
      },
    });
    expect(conductorRuleSchema.safeParse(unbound).success).toBe(true);
  });

  it("accepts participants only for Warzone all with no fallback", () => {
    const participants = rule({
      eligibility: "participants",
      topN: "all",
      fallback: "none",
    });
    expect(conductorRuleSchema.safeParse(participants).success).toBe(true);
    expect(
      conductorRuleSchema.safeParse(
        rule({ eligibility: "participants", topN: 5 }),
      ).success,
    ).toBe(false);
    expect(
      conductorRuleSchema.safeParse(
        rule({
          eligibility: "participants",
          topN: "all",
          fallback: "confirmed_poll_yes",
        }),
      ).success,
    ).toBe(false);
    expect(
      conductorRuleSchema.safeParse(
        rule({
          eligibility: "participants",
          topN: "all",
          source: { ...warzoneSource, target: "frontline-breakthrough" },
        }),
      ).success,
    ).toBe(false);
  });

  it("accepts confirmed_poll_yes only on scored Warzone conductor rules", () => {
    const withFallback = rule({ fallback: "confirmed_poll_yes" });
    expect(conductorRuleSchema.safeParse(withFallback).success).toBe(true);
    // VIP never takes the poll fallback.
    expect(vipRuleSchema.safeParse(withFallback).success).toBe(false);
    // Non-Warzone conductor rules cannot use it.
    expect(
      conductorRuleSchema.safeParse(
        rule({
          fallback: "confirmed_poll_yes",
          source: { ...warzoneSource, target: "seasonal" },
        }),
      ).success,
    ).toBe(false);
    // Participants + fallback is already impossible.
    expect(
      conductorRuleSchema.safeParse(
        rule({
          fallback: "confirmed_poll_yes",
          eligibility: "participants",
        }),
      ).success,
    ).toBe(false);
  });

  it("requires a team scope for storm targets and rejects it elsewhere", () => {
    const storm = rule({
      source: {
        target: "desert-storm",
        seriesId: "s1",
        occurrenceId: "ev-1",
        boardKey: "board-a",
        teamScope: "both",
      },
    });
    expect(conductorRuleSchema.safeParse(storm).success).toBe(true);
    expect(
      conductorRuleSchema.safeParse(
        rule({
          source: { ...storm.source, teamScope: null },
        }),
      ).success,
    ).toBe(false);
    expect(
      conductorRuleSchema.safeParse(
        rule({ source: { ...warzoneSource, teamScope: "A" } }),
      ).success,
    ).toBe(false);
  });

  it("rejects malformed shapes", () => {
    for (const bad of [
      rule({ topN: 2 as never }),
      rule({ topN: 0 as never }),
      rule({ eligibility: "both" as never }),
      rule({ fallback: "sometimes" as never }),
      rule({ source: { ...warzoneSource, target: "zombie-siege" } as never }),
      { kind: "event_scores" },
      { ...rule(), extra: true },
    ]) {
      expect(conductorRuleSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("event_scores identity", () => {
  it("changes on every source and policy field", () => {
    const base = conductorRuleIdentity(rule());
    const variants: EventScoresRule[] = [
      rule({
        source: { ...warzoneSource, target: "frontline-breakthrough" },
      }),
      rule({ source: { ...warzoneSource, seriesId: "s2" } }),
      rule({ source: { ...warzoneSource, occurrenceId: "ev-2" } }),
      rule({ source: { ...warzoneSource, boardKey: "kills" } }),
      rule({ topN: 5 }),
      rule({ topN: "all" }),
      rule({ fallback: "confirmed_poll_yes" }),
      rule({ eligibility: "participants", topN: "all" }),
    ];
    for (const variant of variants) {
      expect(conductorRuleIdentity(variant)).not.toBe(base);
    }
    // Team scope participates too.
    const stormA = rule({
      source: { ...warzoneSource, target: "canyon-storm", teamScope: "A" },
    });
    const stormB = rule({
      source: { ...warzoneSource, target: "canyon-storm", teamScope: "B" },
    });
    expect(conductorRuleIdentity(stormA)).not.toBe(
      conductorRuleIdentity(stormB),
    );
    // VIP identity covers the same fields.
    expect(vipRuleIdentity(rule())).toBe(conductorRuleIdentity(rule()));
    expect(vipRuleIdentity(rule({ topN: 5 }))).not.toBe(vipRuleIdentity(rule()));
  });

  it("never collides with free choice or legacy event_top_x", () => {
    const identity = conductorRuleIdentity(rule());
    expect(conductorRuleIdentity(null)).not.toBe(identity);
    expect(
      conductorRuleIdentity({ kind: "event_top_x", eventKey: "x", topN: 10 }),
    ).not.toBe(identity);
  });
});

describe("event_scores derivation", () => {
  it("maps to the event_leaderboard spin source with rule identity", () => {
    const conductor = spinSourceForConductorRule(rule());
    expect(conductor).toEqual({ kind: "event_leaderboard", rule: rule() });
    const vip = spinSourceForVipRule(rule());
    expect(vip).toEqual({ kind: "event_leaderboard", rule: rule() });
  });

  it("has no depleting pool type for either role", () => {
    expect(conductorRulePoolType(rule())).toBeNull();
    expect(vipRulePoolType(rule())).toBeNull();
    // Legacy event_top_x keeps its pool.
    const legacy = {
      kind: "event_top_x",
      eventKey: "capitol_war",
      topN: 10,
    } as const;
    expect(conductorRulePoolType(legacy)).toBe("event_top_x");
  });

  it("spins the wheel (never auto-assigns) and VIP requires lock", () => {
    expect(conductorRuleNeedsWheel(rule())).toBe(true);
    expect(canSpinVipForRule(rule(), false)).toBe(false);
    expect(canSpinVipForRule(rule(), true)).toBe(true);
  });
});

describe("event_scores mechanism", () => {
  it("encodes to the permanent event_scores mechanism, not event_top_x_lottery", () => {
    expect(encodeLegacyConductorMechanism(rule())).toBe("event_scores");
    expect(encodeLegacyVipMechanism(rule())).toBe("event_scores");
    expect(CONDUCTOR_MECHANISMS).toContain("event_scores");
    expect(VIP_MECHANISMS).toContain("event_scores");
  });

  it("decodes mechanism-only history as unrepresentable, not a guess", () => {
    expect(decodeConductorRule({ mechanism: "event_scores" })).toBeNull();
    expect(decodeVipRule({ mechanism: "event_scores" })).toBeNull();
  });

  it("leaves legacy event_top_x decoding intact", () => {
    expect(
      decodeConductorRule({ mechanism: "event_top_x_lottery" }),
    ).toEqual({ kind: "event_top_x", eventKey: "capitol_war", topN: 10 });
    expect(
      decodeVipRule({
        mechanism: "event_top_x_lottery",
        config: { eventKey: "desert", topN: 7 },
      }),
    ).toEqual({ kind: "event_top_x", eventKey: "desert", topN: 7 });
  });
});

describe("event_scores labels", () => {
  it("maps to the approved catalog keys and its own palette id", () => {
    expect(conductorRuleLabelKey(rule())).toBe("eventScores");
    expect(vipRuleLabelKey(rule())).toBe("eventScores");
    expect(paletteIdForRule(rule())).toBe("event_scores");
  });

  it("parses through the nullable helpers", () => {
    const value = rule();
    expect(parseConductorRule(value)).toEqual(value);
    expect(parseVipRule(value)).toEqual(value);
    expect(parseConductorRule({ kind: "event_scores" })).toBeNull();
  });
});

describe("eventUnboundLabelKey", () => {
  const unbound = () =>
    rule({
      source: {
        target: "warzone-duel",
        seriesId: null,
        occurrenceId: null,
        boardKey: null,
        teamScope: null,
      },
    });

  it("returns null for bound event_scores and non-event rules", () => {
    expect(eventUnboundLabelKey(rule(), "tpl-1")).toBeNull();
    expect(eventUnboundLabelKey(null, "tpl-1")).toBeNull();
    expect(
      eventUnboundLabelKey({ kind: "vs_top_n", topN: 3 }, "tpl-1"),
    ).toBeNull();
  });

  it("uses the shared-template helper for template-painted unbound intents", () => {
    expect(eventUnboundLabelKey(unbound(), "tpl-1")).toBe(
      "importedEventNeedsSelection",
    );
  });

  it("keeps eventNotSelected for direct unbound days and legacy event_top_x", () => {
    expect(eventUnboundLabelKey(unbound(), null)).toBe("eventNotSelected");
    expect(eventUnboundLabelKey(unbound(), undefined)).toBe(
      "eventNotSelected",
    );
    expect(
      eventUnboundLabelKey(
        { kind: "event_top_x", eventKey: "capitol_war", topN: 10 },
        "tpl-1",
      ),
    ).toBe("eventNotSelected");
  });
});
