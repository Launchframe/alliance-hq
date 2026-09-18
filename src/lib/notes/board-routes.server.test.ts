import { beforeEach, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { KnowledgeAccessError } from "./resources.server";
const state = vi.hoisted(() => ({ actor: { hqUserId: "author" }, command: vi.fn(), snapshot: vi.fn() }));
vi.mock("./board-access.server", () => ({ requireNoteBoardContext: async () => ({ actor: state.actor }) }));
vi.mock("./boards.server", () => ({ executeNoteBoardCommand: state.command, noteBoardSnapshot: state.snapshot }));
vi.mock("./access.server", () => ({ notesErrorResponse: (error: { code?: string }) => NextResponse.json({ code: error.code }, { status: error.code === "invalid" ? 400 : 409 }) }));
import { GET } from "@/app/api/notes/boards/[id]/route";
import { POST } from "@/app/api/notes/boards/[id]/commands/route";
const params = { params: Promise.resolve({ id: "board" }) };
const command = { kind: "rename", name: "Renamed", expectedVersion: 1, requestId: "request-one" };
beforeEach(() => {
  vi.clearAllMocks();
  state.command.mockResolvedValue({ version: 2 });
  state.snapshot.mockResolvedValue({ id: "board", version: 2, tasks: [], people: [], teams: [] });
});
it.each(["GET", "POST"])("rejects unknown %s board formats before reads or writes", async (method) => {
  const request = new Request("https://notes.invalid/api/notes/boards/board?format=bogus", { method, ...(method === "POST" ? { body: JSON.stringify(command) } : {}) });
  const response = await (method === "GET" ? GET : POST)(request, params);
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: "invalid" });
  expect(state.command).not.toHaveBeenCalled();
  expect(state.snapshot).not.toHaveBeenCalled();
});
it("requests the compact database projection for GET and conflict snapshots", async () => {
  await GET(new Request("https://notes.invalid/api/notes/boards/board?format=summary"), params);
  expect(state.snapshot).toHaveBeenCalledWith(state.actor, "board", true);
  state.snapshot.mockClear(); state.command.mockRejectedValue(new KnowledgeAccessError("changed"));
  const response = await POST(new Request("https://notes.invalid/api/notes/boards/board/commands?format=summary", { method: "POST", body: JSON.stringify(command) }), params);
  expect(response.status).toBe(409);
  expect(state.snapshot).toHaveBeenCalledWith(state.actor, "board", true);
});
