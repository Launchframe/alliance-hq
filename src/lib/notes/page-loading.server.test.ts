import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ page: vi.fn(), note: vi.fn(), actor: { kind: "web", allianceId: "alliance", hqUserId: "author", canCreate: true, canReadBoards: true } }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("page_not_found"); } }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("@/components/notes/NotesClient", () => ({ NotesClient: () => null }));
vi.mock("@/lib/session", () => ({ requirePageSession: async () => ({ id: "session" }) }));
vi.mock("@/lib/rbac/page-permission", () => ({ requirePagePermission: async () => undefined }));
vi.mock("@/lib/notes/access.server", () => ({ getKnowledgeActorForSession: async () => state.actor }));
vi.mock("@/lib/notes/drafts.server", () => ({ countCaptureDrafts: async () => 0 }));
vi.mock("@/lib/db", async (original) => ({ ...await original<typeof import("@/lib/db")>(), getDb: () => ({ select: () => ({ from: () => ({ where: async () => [{ state: { view: "inbox", layout: "list" }, version: 3 }] }) }) }) }));
vi.mock("@/lib/notes/resources.server", async (original) => ({ ...await original<typeof import("./resources.server")>(), claimDiscordKnowledgeResources: async () => undefined }));
vi.mock("@/lib/performance-notes/repository.server", () => ({ listPerformanceNotePage: state.page, getPerformanceNoteDto: state.note, listPerformanceNoteRoster: async () => [] }));
import DetailPage from "@/app/[locale]/(app)/notes/[id]/page";
import ListPage from "@/app/[locale]/(app)/notes/page";
import { KnowledgeAccessError } from "./resources.server";

beforeEach(() => {
  vi.clearAllMocks();
  state.note.mockResolvedValue({ id: "note-one", body: "Authorized full document" });
  state.page.mockImplementation(async (_actor, filter, cursor) => {
    if (cursor) throw new KnowledgeAccessError("forbidden");
    return { scope: "alliance:author", items: [], filter, nextCursor: null, counts: { notebook: 0, inbox: 0, archived: 0, shared: 0 }, notebooks: [] };
  });
});
it.each([
  { cursor: "{" },
  { cursor: JSON.stringify({ version: 1, scope: "foreign:reader", key: "a".repeat(64), id: "note", updatedAt: "2026-09-15T12:00:00.123456Z", rank: 0 }) },
  { priority: "bogus" },
  { view: "bogus" },
])("keeps authorized detail readable when list navigation is malformed or foreign", async (query) => {
  const result = await DetailPage({ params: Promise.resolve({ id: "note-one" }), searchParams: Promise.resolve(query) });
  expect(result.props.focusedNote.body).toBe("Authorized full document");
  expect(result.props.initialCursor).toBeNull();
  expect(state.page.mock.calls.at(-1)?.[0]).toBe(state.actor);
  expect(state.page.mock.calls.at(-1)?.[2]).toBeNull();
});
it("falls back on malformed list navigation without changing API cursor validation", async () => {
  const result = await ListPage({ searchParams: Promise.resolve({ cursor: "{" }) });
  expect(result.props.initialCursor).toBeNull();
  expect(result.props.initial.scope).toBe("alliance:author");
});
it("still denies an unreadable document before loading the list", async () => {
  state.note.mockResolvedValue(null);
  await expect(DetailPage({ params: Promise.resolve({ id: "note-one" }), searchParams: Promise.resolve({ cursor: "{" }) })).rejects.toThrow("page_not_found");
  expect(state.page).not.toHaveBeenCalled();
});
it("does not hide unexpected list failures behind cursor recovery", async () => {
  state.page.mockRejectedValue(new Error("database unavailable"));
  await expect(DetailPage({ params: Promise.resolve({ id: "note-one" }), searchParams: Promise.resolve({}) })).rejects.toThrow("database unavailable");
});
