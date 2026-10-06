import { beforeEach, expect, it, vi } from "vitest";
import type { KnowledgeActor } from "@/lib/notes/policy.shared";

const { getOfficerChatSessionForAlliance } = vi.hoisted(() => ({
  getOfficerChatSessionForAlliance: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./repository.server", () => ({ getOfficerChatSessionForAlliance }));
vi.mock("./embed-corpus.server", () => ({ knowledgeTestProviderEnabled: () => false }));
vi.mock("./llm-config.server", () => ({ isOfficerIntelLlmConfigured: () => false, officerIntelLlmModel: () => "unused" }));

import { synthesizeOfficerMeetingNote } from "./synthesize.server";

const actor = { kind: "web", allianceId: "alliance", hqUserId: "owner", isOfficer: true } as KnowledgeActor;

beforeEach(() => {
  getOfficerChatSessionForAlliance.mockReset();
});

it("does not synthesize another officer's readable chat log", async () => {
  getOfficerChatSessionForAlliance.mockResolvedValue({ id: "session", createdByHqUserId: "owner" });
  await expect(synthesizeOfficerMeetingNote({
    actor, sessionId: "session", allianceId: "alliance", hqUserId: "peer", sessionTitle: "Log", channelLabel: null,
  })).resolves.toEqual({ error: "not_found" });
  getOfficerChatSessionForAlliance.mockResolvedValue({ id: "session", createdByHqUserId: "owner" });
  await expect(synthesizeOfficerMeetingNote({
    actor, sessionId: "session", allianceId: "alliance", hqUserId: "owner", sessionTitle: "Log", channelLabel: null,
  })).resolves.toEqual({ error: "not_configured" });
});
