/** Cross-tab signal when `sessions.current_alliance_id` changes (alliance picker). */
export const ALLIANCE_SESSION_CONTEXT_STORAGE_KEY =
  "alliance-hq-session-alliance-context";

export type AllianceSessionContextPayload = {
  allianceId: string;
  at: number;
};

export function parseAllianceSessionContextPayload(
  raw: string | null,
): AllianceSessionContextPayload | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<AllianceSessionContextPayload>;
    if (
      typeof parsed.allianceId === "string" &&
      parsed.allianceId.trim().length > 0 &&
      typeof parsed.at === "number"
    ) {
      return { allianceId: parsed.allianceId, at: parsed.at };
    }
  } catch {
    return null;
  }
  return null;
}

export function readAllianceSessionContextPayload(): AllianceSessionContextPayload | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return parseAllianceSessionContextPayload(
      window.localStorage.getItem(ALLIANCE_SESSION_CONTEXT_STORAGE_KEY),
    );
  } catch {
    return null;
  }
}

/** Call after PATCH /api/session/current-alliance succeeds. */
export function notifyAllianceSessionContextChanged(allianceId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  const payload: AllianceSessionContextPayload = {
    allianceId,
    at: Date.now(),
  };
  try {
    window.localStorage.setItem(
      ALLIANCE_SESSION_CONTEXT_STORAGE_KEY,
      JSON.stringify(payload),
    );
    // `storage` fires in other tabs only — not the writer (avoids double reload).
  } catch {
    // ignore storage failures
  }
}

export function subscribeAllianceSessionContextChanged(
  onChange: () => void,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  const handler = (event: StorageEvent) => {
    if (event.key !== ALLIANCE_SESSION_CONTEXT_STORAGE_KEY) {
      return;
    }
    onChange();
  };
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener("storage", handler);
  };
}
