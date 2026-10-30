import { sanitizeBugReportConsoleText } from "@/lib/feedback/bug-report-log-sanitize";

export const ASHED_NETWORK_LOG_MAX_ENTRIES = 100;
export const ASHED_NETWORK_LOG_MAX_CHARS = 32_000;

const LOG_KEY = "alliance-hq-ashed-network-log-v1";

export type AshedClientTransactionKind = "hq_api" | "ashed_sync" | "ashed_op";

export type AshedClientTransactionOutcome =
  | "ok"
  | "error"
  | "running"
  | "cancelled";

export type AshedClientTransaction = {
  id: string;
  at: string;
  kind: AshedClientTransactionKind;
  method?: string;
  path: string;
  status?: number;
  durationMs?: number;
  outcome: AshedClientTransactionOutcome;
  code?: string;
  /** Stable op id for i18n labels (e.g. roster_sync). */
  labelKey?: string;
};

type Listener = () => void;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeAshedNetworkLog(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readRaw(): AshedClientTransaction[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTransactionShape);
  } catch {
    return [];
  }
}

function writeRaw(entries: AshedClientTransaction[], notify: boolean): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(LOG_KEY, JSON.stringify(entries));
  if (notify) {
    emit();
  }
}

function isTransactionShape(value: unknown): value is AshedClientTransaction {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.at === "string" &&
    typeof row.path === "string" &&
    typeof row.outcome === "string" &&
    typeof row.kind === "string"
  );
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `ashed-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function sanitizeAshedNetworkPath(path: string): string {
  const withoutOrigin = path.startsWith("http")
    ? (() => {
        try {
          return new URL(path).pathname;
        } catch {
          return path.split("?")[0] ?? path;
        }
      })()
    : path.split("?")[0] ?? path;
  return sanitizeBugReportConsoleText(withoutOrigin).slice(0, 240);
}

export function loadAshedNetworkLog(): AshedClientTransaction[] {
  return readRaw();
}

export function clearAshedNetworkLog(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(LOG_KEY);
  emit();
}

export function recordAshedClientTransaction(
  input: Omit<AshedClientTransaction, "id" | "at"> & {
    id?: string;
    at?: string;
  },
  options?: { notify?: boolean },
): AshedClientTransaction {
  const entry: AshedClientTransaction = {
    id: input.id ?? newId(),
    at: input.at ?? new Date().toISOString(),
    kind: input.kind,
    method: input.method,
    path: sanitizeAshedNetworkPath(input.path),
    status: input.status,
    durationMs: input.durationMs,
    outcome: input.outcome,
    code: input.code ? sanitizeBugReportConsoleText(input.code).slice(0, 80) : undefined,
    labelKey: input.labelKey,
  };

  const next = [entry, ...readRaw()].slice(0, ASHED_NETWORK_LOG_MAX_ENTRIES);
  writeRaw(next, options?.notify !== false);
  return entry;
}

export function summarizeAshedNetworkLog(entries: AshedClientTransaction[] = loadAshedNetworkLog()): {
  total: number;
  errorCount: number;
  runningCount: number;
  p50DurationMs: number | null;
  p95DurationMs: number | null;
} {
  const durations = entries
    .map((entry) => entry.durationMs)
    .filter((ms): ms is number => typeof ms === "number" && Number.isFinite(ms))
    .sort((a, b) => a - b);

  return {
    total: entries.length,
    errorCount: entries.filter((entry) => entry.outcome === "error").length,
    runningCount: entries.filter((entry) => entry.outcome === "running").length,
    p50DurationMs: percentile(durations, 0.5),
    p95DurationMs: percentile(durations, 0.95),
  };
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * p) - 1),
  );
  return sorted[index] ?? null;
}

export function formatAshedNetworkLogForBugReport(
  entries: AshedClientTransaction[] = loadAshedNetworkLog(),
): string | undefined {
  if (entries.length === 0) {
    return undefined;
  }

  const lines = entries.map((entry) => {
    const parts = [
      entry.at,
      entry.kind,
      entry.method ?? "-",
      entry.path,
      entry.outcome,
      entry.status != null ? String(entry.status) : "-",
      entry.durationMs != null ? `${entry.durationMs}ms` : "-",
      entry.code ?? "-",
      entry.labelKey ?? "-",
    ];
    return parts.join(" | ");
  });

  const header =
    "at | kind | method | path | outcome | status | duration | code | label";
  const body = [header, ...lines].join("\n");
  const sanitized = sanitizeBugReportConsoleText(body);
  if (sanitized.length <= ASHED_NETWORK_LOG_MAX_CHARS) {
    return sanitized;
  }
  return `${sanitized.slice(sanitized.length - ASHED_NETWORK_LOG_MAX_CHARS)}\n…(truncated)`;
}

function recordLabeledAshedSyncTransaction(input: {
  status: "running" | "idle" | "failed";
  path: string;
  method: string;
  labelKey: string;
  lastErrorCode?: string | null;
}): void {
  if (input.status === "idle") {
    recordAshedClientTransaction({
      kind: "ashed_sync",
      path: input.path,
      method: input.method,
      outcome: "ok",
      labelKey: input.labelKey,
    });
    return;
  }
  if (input.status === "running") {
    recordAshedClientTransaction({
      kind: "ashed_sync",
      path: input.path,
      method: input.method,
      outcome: "running",
      labelKey: input.labelKey,
    });
    return;
  }
  recordAshedClientTransaction({
    kind: "ashed_sync",
    path: input.path,
    method: input.method,
    outcome: "error",
    code: input.lastErrorCode ?? "ashed_sync_failed",
    labelKey: input.labelKey,
  });
}

/** Record roster sync status transitions from the members UI (no fetch patch). */
export function recordRosterAshedSyncTransaction(input: {
  status: "running" | "idle" | "failed";
  lastErrorCode?: string | null;
}): void {
  recordLabeledAshedSyncTransaction({
    status: input.status,
    path: "/api/members",
    method: "GET",
    labelKey: "roster_sync",
    lastErrorCode: input.lastErrorCode,
  });
}

/** Record VS Performance matchup import/sync outcomes (no fetch patch). */
export function recordVsMatchupImportTransaction(input: {
  status: "running" | "idle" | "failed";
  lastErrorCode?: string | null;
}): void {
  recordLabeledAshedSyncTransaction({
    status: input.status,
    path: "/api/vs-performance/matchup/import",
    method: "POST",
    labelKey: "vs_import",
    lastErrorCode: input.lastErrorCode,
  });
}
