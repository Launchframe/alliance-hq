import { beforeEach, describe, expect, it, vi } from "vitest";

import { handlePerformanceNoteSlash } from "@/lib/performance-notes/discord-handlers.server";

vi.mock("@/lib/vr/bot-officer-auth", () => ({
  callerCanRunVrReport: vi.fn(),
}));

vi.mock("@/lib/performance-notes/repository.server", () => ({
  createPerformanceNote: vi.fn(),
  attachMembersToPerformanceNote: vi.fn(),
  getPerformanceNoteForAlliance: vi.fn(),
}));

vi.mock("@/lib/vr/repository", () => ({
  getAllianceById: vi.fn(),
  getDiscordHqLink: vi.fn(),
  saveDiscordBotPending: vi.fn(),
}));

vi.mock("@/lib/vr/member-roster", () => ({
  loadAllianceMembersForBot: vi.fn(),
}));

import { callerCanRunVrReport } from "@/lib/vr/bot-officer-auth";
import { createPerformanceNote } from "@/lib/performance-notes/repository.server";
import { saveDiscordBotPending } from "@/lib/vr/repository";

describe("handlePerformanceNoteSlash", () => {
  beforeEach(() => {
    vi.mocked(callerCanRunVrReport).mockReset();
    vi.mocked(createPerformanceNote).mockReset();
    vi.mocked(saveDiscordBotPending).mockReset();
  });

  it("rejects non-officers", async () => {
    vi.mocked(callerCanRunVrReport).mockResolvedValue(false);
    const result = await handlePerformanceNoteSlash({
      allianceId: "a1",
      discordUserId: "d1",
      locale: "en-US",
      text: "hello",
    });
    expect(result).toEqual({
      type: "message",
      content: expect.stringContaining("officers"),
    });
    expect(createPerformanceNote).not.toHaveBeenCalled();
  });

  it("saves a thought and asks to attach a member", async () => {
    vi.mocked(callerCanRunVrReport).mockResolvedValue(true);
    vi.mocked(createPerformanceNote).mockResolvedValue("note-1");
    const result = await handlePerformanceNoteSlash({
      allianceId: "a1",
      discordUserId: "d1",
      locale: "en-US",
      text: "Cookie carried the rally",
    });
    expect(createPerformanceNote).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "note",
        intakeMode: "thought",
        body: "Cookie carried the rally",
      }),
    );
    expect(result.type).toBe("message");
    if (result.type === "message") {
      expect(result.content).toContain("Your note has been saved.");
      expect(result.content).toContain("/notes/note-1");
      expect(result.components?.[0]?.components[0]?.custom_id).toBe("note:attach:yes");
    }
  });
});
