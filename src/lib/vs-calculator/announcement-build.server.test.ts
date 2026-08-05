import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/vs-calculator/shiny-sync.server", () => ({
  resolveShinyWeekdaysForAlliance: vi.fn(),
}));

vi.mock("@/lib/vs-calculator/inventory.server", () => ({
  listActiveVsCatalogDefs: vi.fn(),
}));

import { buildVsDailyAnnouncementPreview } from "@/lib/vs-calculator/announcement-build.server";
import { listActiveVsCatalogDefs } from "@/lib/vs-calculator/inventory.server";
import { resolveShinyWeekdaysForAlliance } from "@/lib/vs-calculator/shiny-sync.server";

// Server calendar is UTC-2: noon-UTC anchors land on the same server day.
// 2024-01-12 = Fri, 2024-01-13 = Sat, 2024-01-14 = Sun, 2024-01-07 = Sun.
function noonUtc(dateStr: string): Date {
  return new Date(`${dateStr}T12:00:00.000Z`);
}

describe("buildVsDailyAnnouncementPreview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listActiveVsCatalogDefs).mockResolvedValue([
      {
        slug: "widget",
        displayName: "Widget",
        pointsByDay: { 1: 10 },
        sortOrder: 0,
      },
    ]);
  });

  it("shows the earn-points catalog on a weekday (Mon-Fri) target", async () => {
    vi.mocked(resolveShinyWeekdaysForAlliance).mockResolvedValue(null);

    const { message, targetDate } = await buildVsDailyAnnouncementPreview({
      allianceId: "a1",
      now: noonUtc("2024-01-07"), // Sunday -> target Monday
    });

    expect(targetDate).toBe("2024-01-08");
    expect(message).toContain("Earn points");
    expect(message).toContain("Widget");
    expect(message).not.toContain("Reminders");
  });

  it("shows a Buster Day reminder (no catalog) on a Saturday target", async () => {
    // Tue/Sat shiny spawns so Saturday's rollover hint fires.
    vi.mocked(resolveShinyWeekdaysForAlliance).mockResolvedValue([2, 6]);

    const { message, targetDate } = await buildVsDailyAnnouncementPreview({
      allianceId: "a1",
      now: noonUtc("2024-01-12"), // Friday -> target Saturday
    });

    expect(targetDate).toBe("2024-01-13");
    expect(message).not.toContain("Earn points");
    expect(message).toContain("Reminders");
    expect(message).toContain("Buster Day is here");
    expect(message).toContain("Rollover shiny tasks into Saturday Enemy Buster.");
  });

  it("shows shiny + radar-for-Monday + gather-before-reset reminders on a Sunday target", async () => {
    vi.mocked(resolveShinyWeekdaysForAlliance).mockResolvedValue(null);

    const { message, targetDate } = await buildVsDailyAnnouncementPreview({
      allianceId: "a1",
      now: noonUtc("2024-01-13"), // Saturday -> target Sunday
    });

    expect(targetDate).toBe("2024-01-14");
    expect(message).not.toContain("Earn points");
    expect(message).toContain("Reminders");
    expect(message).toContain("Wrap up or save shiny tasks before the week resets.");
    expect(message).toContain("Save radar intel for Monday Radar Training.");
    expect(message).toContain("Troops should be out gathering before Reset.");
  });

  it("localizes Sunday reminders and the calculator URL for pt-BR", async () => {
    vi.mocked(resolveShinyWeekdaysForAlliance).mockResolvedValue(null);

    const { message } = await buildVsDailyAnnouncementPreview({
      allianceId: "a1",
      locale: "pt-BR",
      now: noonUtc("2024-01-13"), // Saturday -> target Sunday
    });

    expect(message).toContain("Lembretes");
    expect(message).toContain("As tropas devem estar coletando antes do Reset.");
    expect(message).toContain("/pt-BR/tools/vs-calculator");
  });
});
