import { describe, expect, it } from "vitest";
import { escapeTimeOffDiscordText, parseTimeOffCustomId, timeOffComponentNeedsModal, timeOffCustomId } from "./discord-workflow.shared";
import { parseTimeOffMessage } from "./parse-natural-language.shared";

const token = "abcdefghijklmnopqrstu";

describe("time-off Discord controls", () => {
  it("uses bounded opaque state IDs with no embedded notes or member identifiers", () => {
    const id = timeOffCustomId(token, "confirm");
    expect(id.length).toBeLessThanOrEqual(100);
    expect(parseTimeOffCustomId(id)).toEqual({ token, action: "confirm" });
    expect(parseTimeOffCustomId("timeoff:short:confirm")).toBeNull();
    expect(parseTimeOffCustomId(`timeoff:${token}:confirm:other-user`)).toBeNull();
    expect(parseTimeOffCustomId(null)).toBeNull();
  });

  it("only uses an immediate response for modal-opening buttons", () => {
    expect(timeOffComponentNeedsModal(timeOffCustomId(token, "new"))).toBe(true);
    expect(timeOffComponentNeedsModal(timeOffCustomId(token, "edit"))).toBe(true);
    expect(timeOffComponentNeedsModal(timeOffCustomId(token, "confirm"))).toBe(false);
    expect(timeOffComponentNeedsModal(timeOffCustomId(token, "submit"))).toBe(false);
  });

  it("neutralizes mentions and markdown in private user-entered text", () => {
    expect(escapeTimeOffDiscordText("@everyone **name** <@123>")).not.toContain("@everyone");
    expect(escapeTimeOffDiscordText("**name**")).toBe("\\*\\*name\\*\\*");
  });
});

describe("Portuguese time-off date entry", () => {
  it.each([
    ["Estarei ausente na próxima semana.", "2026-09-14", "2026-09-20"],
    ["Ausente amanhã", "2026-09-09", "2026-09-09"],
    ["Ausente hoje", "2026-09-08", "2026-09-08"],
    ["Fora esta semana", "2026-09-07", "2026-09-13"],
  ])("previews %s without translating private reasons", (message, startDate, endDate) => {
    const result = parseTimeOffMessage(message, "2026-09-08");
    expect(result).toMatchObject({ ok: true, parsed: { startDate, endDate, notes: message } });
  });
});
