import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ version: vi.fn(), listen: vi.fn(), end: vi.fn(), stop: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("postgres", () => ({ default: () => ({ end: mocks.end }) }));
vi.mock("@/lib/db/url", () => ({ getListenDatabaseUrl: () => "postgres://example/e2e" }));
vi.mock("@/lib/db/postgres-listen", () => ({ startPostgresListen: mocks.listen }));
vi.mock("@/lib/notes/board-access.server", () => ({ requireNoteBoardContext: async () => ({ actor: { allianceId: "alliance", hqUserId: "author" } }) }));
vi.mock("@/lib/notes/boards.server", () => ({ noteBoardVersion: mocks.version }));
vi.mock("@/lib/notes/access.server", () => ({ notesErrorResponse: () => Response.json({ code: "failed" }, { status: 500 }) }));
vi.mock("@/lib/notes/resources.server", () => ({ KnowledgeAccessError: class extends Error { constructor(public code: string, public status = 403) { super(code); } } }));

import { GET } from "./route";
import { KnowledgeAccessError } from "@/lib/notes/resources.server";

beforeEach(() => { vi.clearAllMocks(); mocks.end.mockResolvedValue(undefined); mocks.listen.mockResolvedValue(mocks.stop); mocks.version.mockReset().mockResolvedValueOnce(1); });
describe("Notes board SSE recovery", () => {
  it("closes a transiently failed stream for native reconnection without revoking the board", async () => {
    mocks.version.mockRejectedValueOnce(new Error("database unavailable"));
    const response = await GET(new Request("http://localhost/api/events/notes/boards/board"), { params: Promise.resolve({ id: "board" }) });
    expect(await response.text()).not.toContain("revoked");
    expect(mocks.end).toHaveBeenCalledOnce();
    expect(mocks.stop).toHaveBeenCalledOnce();
  });
  it("explicitly revokes and cleans up when eligibility is lost", async () => {
    mocks.version.mockRejectedValueOnce(new KnowledgeAccessError("forbidden"));
    const response = await GET(new Request("http://localhost/api/events/notes/boards/board"), { params: Promise.resolve({ id: "board" }) });
    expect(await response.text()).toContain("event: revoked");
    expect(mocks.end).toHaveBeenCalledOnce();
  });
  it("cleans up failed listener startup instead of leaving a connection until the deadline", async () => {
    mocks.listen.mockRejectedValueOnce(new Error("listener unavailable"));
    const response = await GET(new Request("http://localhost/api/events/notes/boards/board"), { params: Promise.resolve({ id: "board" }) });
    expect(await response.text()).not.toContain("revoked");
    expect(mocks.end).toHaveBeenCalledOnce();
  });
});
