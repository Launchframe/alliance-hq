import { afterEach, describe, expect, it, vi } from "vitest";
import { SnapshotAccessRevoked, type SnapshotObserver } from "@/lib/member-board/versioned-live";
import { supportLiveTransport } from "./live-transport.shared";

afterEach(() => vi.unstubAllGlobals());

describe("Support collaboration transport adapter", () => {
  it("uses abortable domain reads and rejects a different alliance or principal", async () => {
    const signal = new AbortController().signal;
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: 2, board: { allianceId: "other" } })));
    vi.stubGlobal("fetch", fetch);
    const transport = supportLiveTransport("alliance", "principal", true);
    await expect(transport.load(signal)).rejects.toBeInstanceOf(SnapshotAccessRevoked);
    expect(fetch).toHaveBeenCalledWith("/api/support-teams", expect.objectContaining({ signal, cache: "no-store" }));
    fetch.mockResolvedValue(new Response(JSON.stringify({ version: 2, board: { allianceId: "alliance" }, actor: { principalId: "other" } })));
    await expect(transport.load(signal)).rejects.toBeInstanceOf(SnapshotAccessRevoked);
    transport.dispose();
  });

  it.each([401, 403])("converts %s into generic revocation without changing domain authorization", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "forbidden" }), { status })));
    const transport = supportLiveTransport("alliance", "principal", true);
    await expect(transport.load(new AbortController().signal)).rejects.toBeInstanceOf(SnapshotAccessRevoked);
    transport.dispose();
  });

  it("validates SSE tenant/version hints and closes the Support stream on disposal", () => {
    const handlers = new Map<string, (event: { type: string; data: string }) => void>();
    const close = vi.fn();
    class Stream {
      constructor(public url: string) {}
      addEventListener(type: string, handler: (event: { type: string; data: string }) => void) { handlers.set(type, handler); }
      close = close;
      onerror: (() => void) | null = null;
    }
    vi.stubGlobal("EventSource", Stream);
    const observer: SnapshotObserver = { ready: vi.fn(), invalidate: vi.fn(), disconnect: vi.fn(), revoke: vi.fn() };
    const transport = supportLiveTransport("alliance", "principal", true);
    const unsubscribe = transport.subscribe(observer);
    handlers.get("ready")!({ type: "ready", data: JSON.stringify({ allianceId: "alliance", version: 4 }) });
    expect(observer.ready).toHaveBeenCalledExactlyOnceWith(4);
    handlers.get("invalidate")!({ type: "invalidate", data: JSON.stringify({ allianceId: "other", version: 99 }) });
    handlers.get("invalidate")!({ type: "invalidate", data: JSON.stringify({ allianceId: "alliance", version: "99" }) });
    expect(observer.invalidate).not.toHaveBeenCalled();
    handlers.get("invalidate")!({ type: "invalidate", data: JSON.stringify({ allianceId: "alliance", version: 5 }) });
    expect(observer.invalidate).toHaveBeenCalledExactlyOnceWith(5);
    unsubscribe();
    transport.dispose();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
