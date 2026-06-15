import { MAX_BUG_REPORT_CONSOLE_LOG_CHARS } from "@/lib/feedback/constants";
import { sanitizeBugReportConsoleText } from "@/lib/feedback/bug-report-log-sanitize";

export type BugReportConsoleLogLevel =
  | "debug"
  | "log"
  | "info"
  | "warn"
  | "error";

export type BugReportConsoleLogEntry = {
  level: BugReportConsoleLogLevel;
  timestamp: number;
  message: string;
};

const MAX_CONSOLE_LOG_ENTRIES = 200;

const CAPTURE_LEVELS: BugReportConsoleLogLevel[] = [
  "debug",
  "log",
  "info",
  "warn",
  "error",
];

let entries: BugReportConsoleLogEntry[] = [];
let installCount = 0;
const originalMethods: Partial<
  Record<BugReportConsoleLogLevel, (...args: unknown[]) => void>
> = {};

function formatConsoleArg(value: unknown): string {
  if (value instanceof Error) {
    return value.stack ?? value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function recordConsoleEntry(level: BugReportConsoleLogLevel, args: unknown[]) {
  entries.push({
    level,
    timestamp: Date.now(),
    message: sanitizeBugReportConsoleText(
      args.map(formatConsoleArg).join(" "),
    ),
  });

  if (entries.length > MAX_CONSOLE_LOG_ENTRIES) {
    entries = entries.slice(entries.length - MAX_CONSOLE_LOG_ENTRIES);
  }
}

export function installBugReportConsoleCapture(): void {
  if (typeof window === "undefined") {
    return;
  }

  installCount += 1;
  if (installCount > 1) {
    return;
  }

  for (const level of CAPTURE_LEVELS) {
    const original = console[level].bind(console);
    originalMethods[level] = original;
    console[level] = (...args: unknown[]) => {
      recordConsoleEntry(level, args);
      original(...args);
    };
  }
}

export function uninstallBugReportConsoleCapture(): void {
  if (typeof window === "undefined" || installCount === 0) {
    return;
  }

  installCount -= 1;
  if (installCount > 0) {
    return;
  }

  for (const level of CAPTURE_LEVELS) {
    const original = originalMethods[level];
    if (original) {
      console[level] = original;
    }
  }

  originalMethods.debug = undefined;
  originalMethods.log = undefined;
  originalMethods.info = undefined;
  originalMethods.warn = undefined;
  originalMethods.error = undefined;
  entries = [];
}

export function formatBugReportConsoleLogs(
  inputEntries: BugReportConsoleLogEntry[] = entries,
): string {
  const text = inputEntries
    .map(({ level, timestamp, message }) => {
      const time = new Date(timestamp).toISOString();
      return `[${time}] ${level.toUpperCase()}: ${message}`;
    })
    .join("\n");

  if (text.length <= MAX_BUG_REPORT_CONSOLE_LOG_CHARS) {
    return text;
  }

  return `${text.slice(text.length - MAX_BUG_REPORT_CONSOLE_LOG_CHARS)}\n…(truncated)`;
}
