import { describe, expect, it } from "vitest";

import {
  buildBattlePlanReminderTitle,
  resolveBattlePlanReminderKind,
} from "@/lib/battle-plan/battle-plan-event-reminders.server";
import {
  CAPTURE_REMINDER_INBOX_KIND,
  DEPOSIT_WINDOW_REMINDER_INBOX_KIND,
} from "@/lib/battle-plan/capture-reminder-inbox.shared";

describe("battle-plan-event-reminders.server", () => {
  it("resolves reminder kinds for capture and deposit_window", () => {
    expect(
      resolveBattlePlanReminderKind({
        eventType: "capture",
        territoryType: "stronghold",
      }),
    ).toBe(CAPTURE_REMINDER_INBOX_KIND);
    expect(
      resolveBattlePlanReminderKind({
        eventType: "deposit_window",
        territoryType: "stronghold",
      }),
    ).toBe(DEPOSIT_WINDOW_REMINDER_INBOX_KIND);
    expect(
      resolveBattlePlanReminderKind({
        eventType: "drop",
        territoryType: "stronghold",
      }),
    ).toBeNull();
  });

  it("builds deposit-window reminder titles with coords", () => {
    expect(
      buildBattlePlanReminderTitle({
        id: "evt-1",
        eventType: "deposit_window",
        territoryType: "stronghold",
        status: "scheduled",
        notes: null,
        level: 6,
        coordX: 100,
        coordY: 200,
      }),
    ).toBe("Deposit window: Lv6 (100, 200)");
  });
});
