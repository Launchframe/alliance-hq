export type AshedConnectionSessionStats = {
  /** ISO timestamp when the current browser session connected (or resumed). */
  connectedAt: string;
  /** Successful `/api/*` requests while connected in this browser session. */
  requestCount: number;
};

const STATS_KEY = "alliance-hq-ashed-connection-session-stats";

type Listener = () => void;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeAshedConnectionSessionStats(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function loadAshedConnectionSessionStats(): AshedConnectionSessionStats | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(STATS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AshedConnectionSessionStats;
    if (typeof parsed.connectedAt !== "string") return null;
    return {
      connectedAt: parsed.connectedAt,
      requestCount:
        typeof parsed.requestCount === "number" ? parsed.requestCount : 0,
    };
  } catch {
    return null;
  }
}

function writeStats(
  stats: AshedConnectionSessionStats,
  options?: { notify?: boolean },
): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  if (options?.notify !== false) {
    emit();
  }
}

export function storeAshedConnectionSessionStats(
  stats: AshedConnectionSessionStats,
): void {
  writeStats(stats, { notify: true });
}

export function startAshedConnectionSession(
  connectedAt: string = new Date().toISOString(),
): AshedConnectionSessionStats {
  const stats: AshedConnectionSessionStats = {
    connectedAt,
    requestCount: 0,
  };
  writeStats(stats, { notify: true });
  return stats;
}

export function ensureAshedConnectionSession(): AshedConnectionSessionStats {
  const existing = loadAshedConnectionSessionStats();
  if (existing) {
    return existing;
  }
  return startAshedConnectionSession();
}

/**
 * Bump the session request counter without notifying React subscribers.
 * Safe on hot paths (PerformanceObserver) — open/poll UI re-reads storage.
 */
export function incrementAshedRequestCountSilent(): AshedConnectionSessionStats | null {
  const current = loadAshedConnectionSessionStats();
  if (!current) {
    return null;
  }
  const next = {
    ...current,
    requestCount: current.requestCount + 1,
  };
  writeStats(next, { notify: false });
  return next;
}

/** Prefer silent bump + explicit UI refresh for shell chrome. */
export function incrementAshedRequestCount(): AshedConnectionSessionStats | null {
  const next = incrementAshedRequestCountSilent();
  if (next) {
    emit();
  }
  return next;
}

export function clearAshedConnectionSessionStats(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(STATS_KEY);
  emit();
}

export function formatConnectedSince(iso: string, locale?: string): string {
  try {
    return new Date(iso).toLocaleString(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

/** Paths that are not counted as Ashed session traffic. */
export function shouldCountAsAshedSessionRequest(url: string): boolean {
  try {
    const path = url.startsWith("http")
      ? new URL(url).pathname
      : url.split("?")[0] ?? url;
    if (!path.startsWith("/api/")) {
      return false;
    }
    if (
      path.startsWith("/api/auth/sign-out") ||
      path.startsWith("/api/auth/disconnect") ||
      path.startsWith("/api/auth/connect") ||
      path.startsWith("/api/health") ||
      path.startsWith("/api/feedback")
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
