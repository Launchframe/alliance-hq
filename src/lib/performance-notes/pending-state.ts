export type PerformanceNotesPendingState =
  | { kind: "perf_note_attach"; noteId: string }
  | {
      kind: "perf_note_clarify";
      noteId: string;
      token: string;
      candidates: Array<{ memberId: string; name: string }>;
    }
  | {
      kind: "perf_batch_clarify";
      command: "commend" | "violation";
      resolved: Array<{ memberId: string; nameRaw: string }>;
      remaining: string[];
      currentToken: string;
      candidates: Array<{ memberId: string; name: string }>;
    }
  | {
      kind: "perf_batch_reason";
      command: "commend" | "violation";
      resolved: Array<{ memberId: string; nameRaw: string }>;
    };

function parseCandidates(value: unknown): Array<{ memberId: string; name: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const rec = row as Record<string, unknown>;
      if (typeof rec.memberId !== "string" || typeof rec.name !== "string") {
        return null;
      }
      return { memberId: rec.memberId, name: rec.name };
    })
    .filter((row): row is { memberId: string; name: string } => row != null);
}

function parseResolved(value: unknown): Array<{ memberId: string; nameRaw: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const rec = row as Record<string, unknown>;
      if (typeof rec.memberId !== "string" || typeof rec.nameRaw !== "string") {
        return null;
      }
      return { memberId: rec.memberId, nameRaw: rec.nameRaw };
    })
    .filter((row): row is { memberId: string; nameRaw: string } => row != null);
}

export function parsePerformanceNotesPending(
  value: unknown,
): PerformanceNotesPendingState | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (r.kind === "perf_note_attach" && typeof r.noteId === "string") {
    return { kind: "perf_note_attach", noteId: r.noteId };
  }
  if (
    r.kind === "perf_note_clarify" &&
    typeof r.noteId === "string" &&
    typeof r.token === "string"
  ) {
    return {
      kind: "perf_note_clarify",
      noteId: r.noteId,
      token: r.token,
      candidates: parseCandidates(r.candidates),
    };
  }
  if (
    (r.kind === "perf_batch_clarify" && r.command === "commend") ||
    (r.kind === "perf_batch_clarify" && r.command === "violation")
  ) {
    if (typeof r.currentToken !== "string") return null;
    return {
      kind: "perf_batch_clarify",
      command: r.command,
      resolved: parseResolved(r.resolved),
      remaining: Array.isArray(r.remaining)
        ? r.remaining.filter((item): item is string => typeof item === "string")
        : [],
      currentToken: r.currentToken,
      candidates: parseCandidates(r.candidates),
    };
  }
  if (
    (r.kind === "perf_batch_reason" && r.command === "commend") ||
    (r.kind === "perf_batch_reason" && r.command === "violation")
  ) {
    return {
      kind: "perf_batch_reason",
      command: r.command,
      resolved: parseResolved(r.resolved),
    };
  }
  return null;
}
