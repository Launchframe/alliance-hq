import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/vr/repository", () => ({ getDiscordUserLocale: vi.fn(), upsertDiscordUserLocale: vi.fn() }));
import { createDiscordTranslator } from "./i18n";

describe("Discord ICU messages", () => {
  it("formats review task counts in both locales", () => {
    expect(createDiscordTranslator("en-US")("performanceNotes.review.saved", { count: 1, url: "/notes/example" })).toBe("Private note saved with 1 task. Open in HQ: /notes/example");
    expect(createDiscordTranslator("pt-BR")("performanceNotes.review.saved", { count: 2, url: "/notes/example" })).toBe("Nota privada salva com 2 tarefas. Abra no HQ: /notes/example");
  });
  it("preserves the approved ordinary interpolation wording", () => {
    expect(createDiscordTranslator("en-US")("performanceNotes.savedAskAttach", { url: "/notes/example" })).toBe("Would you like to link this note to an alliance member? Your note is private, and linking members will not cause the note to be shared. /notes/example");
  });
});
