import { SnapshotAccessRevoked, type SnapshotTransport } from "@/lib/member-board/versioned-live";
import type { NoteBoardSnapshot } from "./board.shared";

export function notesBoardTransport(scope: Pick<NoteBoardSnapshot, "id" | "allianceId" | "principalId">): SnapshotTransport<NoteBoardSnapshot> {
  let stream: EventSource | undefined;
  const close = () => { stream?.close(); stream = undefined; };
  return {
    load: async (signal) => {
      const response = await fetch(`/api/notes/boards/${scope.id}`, { cache: "no-store", signal, headers: { "X-Notes-Scope": `${scope.allianceId}:${scope.principalId}` } });
      const body = await response.json();
      if ([401, 403, 404].includes(response.status)) throw new SnapshotAccessRevoked(body.code);
      if (!response.ok) throw new Error(body.code ?? "failed");
      if (body.id !== scope.id || body.allianceId !== scope.allianceId || body.principalId !== scope.principalId) throw new SnapshotAccessRevoked("scope");
      return body;
    },
    subscribe: (observer) => {
      stream = new EventSource(`/api/events/notes/boards/${scope.id}`);
      const receive = (event: MessageEvent) => {
        try {
          const value = JSON.parse(event.data);
          if (value.boardId !== scope.id || value.allianceId !== scope.allianceId || value.principalId !== scope.principalId || !Number.isSafeInteger(value.version) || value.version < 1) return;
          if (event.type === "ready") observer.ready(value.version); else observer.invalidate(value.version);
        } catch { observer.disconnect(); }
      };
      stream.addEventListener("ready", receive);
      stream.addEventListener("invalidate", receive);
      stream.addEventListener("revoked", () => observer.revoke());
      stream.onerror = () => observer.disconnect();
      return close;
    },
    dispose: close,
  };
}
