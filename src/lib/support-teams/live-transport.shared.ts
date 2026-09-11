import { SnapshotAccessRevoked, type SnapshotTransport } from "@/lib/member-board/versioned-live";
import { SupportClientError, supportRequest } from "./board-client.shared";
import type { SupportSnapshot } from "./types.shared";

export function supportLiveTransport(allianceId: string | undefined, principalId: string | undefined, canRead: boolean): SnapshotTransport<SupportSnapshot> {
  let stream: EventSource | undefined;
  const close = () => { stream?.close(); stream = undefined; };
  return {
    load: async (signal) => {
      try {
        const next = await supportRequest<SupportSnapshot>("/api/support-teams", { signal });
        if ((allianceId && next.board && next.board.allianceId !== allianceId) || (principalId && next.actor && next.actor.principalId !== principalId)) throw new SnapshotAccessRevoked();
        return next;
      } catch (error) {
        if (error instanceof SupportClientError && (error.status === 401 || error.status === 403)) throw new SnapshotAccessRevoked(error.code, { cause: error });
        throw error;
      }
    },
    subscribe: (observer) => {
      if (!canRead) return close;
      stream = new EventSource("/api/events/support-teams");
      const invalidate = (event: MessageEvent) => {
        try {
          const value = JSON.parse(event.data) as { allianceId: string; version: number };
          if (value.allianceId !== allianceId || !Number.isSafeInteger(value.version) || value.version < 0) return;
          if (event.type === "ready") observer.ready(value.version);
          else observer.invalidate(value.version);
        } catch { observer.disconnect(); }
      };
      stream.addEventListener("ready", invalidate);
      stream.addEventListener("invalidate", invalidate);
      stream.onerror = () => observer.disconnect();
      return close;
    },
    dispose: close,
  };
}
