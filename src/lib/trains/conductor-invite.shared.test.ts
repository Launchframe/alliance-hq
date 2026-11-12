import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  conductorToVipPowerDelta,
  defaultTrainsHubDate,
  renderConductorInviteTemplate,
} from "@/lib/trains/conductor-invite.shared";
import { getTrainWeekStart } from "@/lib/trains/train-week-calendar.shared";

const TEMPLATE =
  "Hey {conductor.commander.nickname}, you won the train! {vip.commander.name} will be your VIP. Please invite them as your {conductorToVipPowerDelta > 0.1 ? 'defender' : 'guest'}";

describe("conductorToVipPowerDelta", () => {
  it("is the conductor's surplus relative to the VIP", () => {
    expect(conductorToVipPowerDelta(120, 100)).toBeCloseTo(0.2);
  });

  it("is null when either power is missing", () => {
    expect(conductorToVipPowerDelta(null, 100)).toBeNull();
    expect(conductorToVipPowerDelta(120, null)).toBeNull();
    expect(conductorToVipPowerDelta(120, 0)).toBeNull();
  });
});

describe("renderConductorInviteTemplate", () => {
  it("uses the defender word when the conductor is more than 10% stronger", () => {
    expect(
      renderConductorInviteTemplate(TEMPLATE, {
        conductorNickname: "Nova",
        vipName: "Boggle",
        conductorPowerM: 120,
        vipPowerM: 100,
      }),
    ).toBe(
      "Hey Nova, you won the train! Boggle will be your VIP. Please invite them as your defender",
    );
  });

  it("inserts names that contain replacement patterns literally", () => {
    expect(
      renderConductorInviteTemplate(TEMPLATE, {
        conductorNickname: "No$&va",
        vipName: "Bo$$'ggle",
        conductorPowerM: 120,
        vipPowerM: 100,
      }),
    ).toBe(
      "Hey No$&va, you won the train! Bo$$'ggle will be your VIP. Please invite them as your defender",
    );
  });

  it("fills each locale default without leaving the role token in place", () => {
    for (const locale of ["en-US", "pt-BR", "id"]) {
      const messages = JSON.parse(
        readFileSync(join(process.cwd(), "messages", `${locale}.json`), "utf8"),
      ) as {
        trains: { guidedFlow: { conductorInvite: { defaultTemplate: string } } };
      };
      const rendered = renderConductorInviteTemplate(
        messages.trains.guidedFlow.conductorInvite.defaultTemplate,
        {
          conductorNickname: "Nova",
          vipName: "Boggle",
          conductorPowerM: 120,
          vipPowerM: 100,
        },
      );
      expect(rendered).toContain("Nova");
      expect(rendered).toContain("Boggle");
      expect(rendered).not.toContain("{");
      expect(rendered).not.toContain("conductorToVipPowerDelta");
    }
  });

  it("uses the guest word at exactly 10% and when power is unknown", () => {
    expect(
      renderConductorInviteTemplate(TEMPLATE, {
        conductorNickname: "Nova",
        vipName: "Boggle",
        conductorPowerM: 110,
        vipPowerM: 100,
      }),
    ).toContain("guest");
    expect(
      renderConductorInviteTemplate(TEMPLATE, {
        conductorNickname: "Nova",
        vipName: "Boggle",
        conductorPowerM: null,
        vipPowerM: null,
      }),
    ).toContain("guest");
  });
});

describe("defaultTrainsHubDate", () => {
  const today = "2026-11-12";
  const lockedAt = "2026-11-12T04:00:00.000Z";

  it("keeps an explicit date", () => {
    expect(
      defaultTrainsHubDate({
        today,
        leadDays: 2,
        explicitDate: today,
        todayLockedAt: lockedAt,
        now: new Date("2026-11-13T04:00:00.000Z"),
      }),
    ).toBe(today);
  });

  it("stays on today when lead time is under a day or today is unlocked", () => {
    expect(
      defaultTrainsHubDate({
        today,
        leadDays: 0,
        explicitDate: null,
        todayLockedAt: lockedAt,
        now: new Date("2026-11-13T04:00:00.000Z"),
      }),
    ).toBe(today);
    expect(
      defaultTrainsHubDate({
        today,
        leadDays: 1,
        explicitDate: null,
        todayLockedAt: null,
        now: new Date("2026-11-13T04:00:00.000Z"),
      }),
    ).toBe(today);
  });

  it("opens tomorrow when today's lock is older than 8 hours and lead time is at least 1", () => {
    expect(
      defaultTrainsHubDate({
        today,
        leadDays: 1,
        explicitDate: null,
        todayLockedAt: lockedAt,
        now: new Date("2026-11-12T12:00:00.001Z"),
      }),
    ).toBe("2026-11-13");
  });

  it("can open on a date in the next train week", () => {
    // Monday, default train week starts Tuesday, so tomorrow is a new week.
    const today = "2026-11-16";
    const hubDate = defaultTrainsHubDate({
      today,
      leadDays: 1,
      explicitDate: null,
      todayLockedAt: "2026-11-16T04:00:00.000Z",
      now: new Date("2026-11-16T12:00:00.001Z"),
    });
    expect(hubDate).toBe("2026-11-17");
    expect(getTrainWeekStart(hubDate)).not.toBe(getTrainWeekStart(today));
  });

  it("stays on today when the lock is exactly 8 hours old", () => {
    expect(
      defaultTrainsHubDate({
        today,
        leadDays: 1,
        explicitDate: null,
        todayLockedAt: lockedAt,
        now: new Date("2026-11-12T12:00:00.000Z"),
      }),
    ).toBe(today);
  });
});
