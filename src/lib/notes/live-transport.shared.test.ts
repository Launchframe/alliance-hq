import { afterEach, describe, expect, it, vi } from "vitest";
import { SnapshotAccessRevoked } from "@/lib/member-board/versioned-live";
import { notesBoardTransport } from "./live-transport.shared";

const scope = { id: "board-one", allianceId: "alliance", principalId: "author" };
afterEach(() => vi.unstubAllGlobals());
describe("scoped Notes board transport", () => {
  it("rejects foreign board, tenant, and principal snapshots", async () => {
    for (const patch of [{ id: "other" }, { allianceId: "other" }, { principalId: "other" }]) {
      vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...scope, ...patch, version: 1 })));
      await expect(notesBoardTransport(scope).load(new AbortController().signal)).rejects.toBeInstanceOf(SnapshotAccessRevoked);
    }
  });
  it("revokes on missing board access rather than retaining a snapshot", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code: "forbidden" }, { status: 403 })));
    await expect(notesBoardTransport(scope).load(new AbortController().signal)).rejects.toBeInstanceOf(SnapshotAccessRevoked);
  });
  it("accepts only exact authorized events and disposes its stream", () => {
    const stream = new EventTarget() as EventTarget & { close: ReturnType<typeof vi.fn> };
    stream.close = vi.fn();
    vi.stubGlobal("EventSource", class { constructor() { return stream; } });
    const observer = { ready: vi.fn(), invalidate: vi.fn(), disconnect: vi.fn(), revoke: vi.fn() };
    const transport = notesBoardTransport(scope);
    const stop = transport.subscribe(observer);
    const event = (patch: Record<string, unknown>) => new MessageEvent("invalidate", { data: JSON.stringify({ boardId: scope.id, allianceId: scope.allianceId, principalId: scope.principalId, version: 3, ...patch }) });
    stream.dispatchEvent(event({ boardId: "foreign" }));
    stream.dispatchEvent(event({ principalId: "foreign" }));
    stream.dispatchEvent(event({ version: -1 }));
    expect(observer.invalidate).not.toHaveBeenCalled();
    stream.dispatchEvent(event({}));
    expect(observer.invalidate).toHaveBeenCalledWith(3);
    stream.dispatchEvent(new MessageEvent("revoked", { data: "{}" }));
    expect(observer.revoke).toHaveBeenCalledOnce();
    stop(); transport.dispose();
    expect(stream.close).toHaveBeenCalledOnce();
  });
});
