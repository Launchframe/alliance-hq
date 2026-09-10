import type { OfficerIntelAskCitation } from "@/lib/officer-intel/ask-types.shared";
import type { OfficerActionItemRecord } from "@/lib/officer-intel/synthesis-types.shared";

export const THREAD_SUMMARY_EVERY_N_TURNS = 3;
export const MAX_OPEN_ACTION_ITEMS_IN_PROMPT = 12;
export const MAX_ACTION_ITEM_BLOCK_CHARS = 2000;
export const MAX_SYNTHESIZE_TRANSCRIPT_CHARS = 12_000 * 4;

export type AskRetrievedChunkLike = {
  sourceType: "approved_note" | "action_item";
  sourceId: string;
  sessionId: string | null;
  text: string;
  sessionTitle: string | null;
  channelLabel: string | null;
  sessionAt: string | null;
};

export function shouldRefreshThreadSummary(turnCount: number): boolean {
  return turnCount > 0 && turnCount % THREAD_SUMMARY_EVERY_N_TURNS === 0;
}

export function citationHref(
  sourceType: "approved_note" | "action_item",
  sourceId: string,
): string {
  if (sourceType === "approved_note") {
    return `/officer-intel/notes/${sourceId}`;
  }
  return `/officer-intel/action-items?focus=${encodeURIComponent(sourceId)}`;
}

export function citationsFromChunks(
  chunks: AskRetrievedChunkLike[],
): OfficerIntelAskCitation[] {
  const seen = new Set<string>();
  const citations: OfficerIntelAskCitation[] = [];
  for (const chunk of chunks) {
    const key = `${chunk.sourceType}:${chunk.sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push({
      sourceType: chunk.sourceType,
      sourceId: chunk.sourceId,
      sessionId: chunk.sessionId,
      sessionTitle: chunk.sessionTitle,
      channelLabel: chunk.channelLabel,
      sessionAt: chunk.sessionAt,
      href: citationHref(chunk.sourceType, chunk.sourceId),
    });
  }
  return citations;
}

export function formatRetrievedChunksForPrompt(
  chunks: AskRetrievedChunkLike[],
): string {
  if (chunks.length === 0) {
    return "(No matching approved meeting notes or action-item chunks.)";
  }
  return chunks
    .map((chunk, index) => {
      const kind =
        chunk.sourceType === "approved_note"
          ? "approved meeting notes"
          : "open action item";
      const session = chunk.sessionTitle
        ? ` session="${chunk.sessionTitle}"`
        : "";
      return `[${index + 1} ${kind}${session} id=${chunk.sourceId}]\n${chunk.text}`;
    })
    .join("\n\n");
}

export function formatOpenActionItemsForPrompt(
  items: Pick<
    OfficerActionItemRecord,
    "title" | "description" | "assigneeMemberName" | "assigneeNameRaw" | "dueAt" | "dueHint" | "status" | "priority"
  >[],
): string {
  if (items.length === 0) {
    return "(No open action items.)";
  }
  const lines: string[] = [];
  for (const item of items.slice(0, MAX_OPEN_ACTION_ITEMS_IN_PROMPT)) {
    const assignee =
      item.assigneeMemberName?.trim() || item.assigneeNameRaw?.trim() || "unassigned";
    const due = item.dueAt?.trim() || item.dueHint?.trim() || "no due date";
    lines.push(
      `- [${item.priority}/${item.status}] ${item.title.trim()} — ${assignee}; due ${due}${
        item.description?.trim() ? `; ${item.description.trim()}` : ""
      }`,
    );
  }
  const body = lines.join("\n");
  if (body.length <= MAX_ACTION_ITEM_BLOCK_CHARS) return body;
  return `${body.slice(0, MAX_ACTION_ITEM_BLOCK_CHARS)}\n(truncated)`;
}

export function formatThreadSummaryForPrompt(
  runningSummary: string | null | undefined,
): string {
  const trimmed = runningSummary?.trim();
  if (!trimmed) return "(No prior conversation summary.)";
  return trimmed;
}

export function buildOfficerIntelAskSystemPrompt(): string {
  return [
    "You are an alliance officer intelligence assistant for Alliance HQ.",
    "Answer only from the retrieved approved meeting notes, the open action-items list, and (if you call the tool) a single session transcript.",
    "Do not invent decisions, dates, assignees, or player identities.",
    "Never display or guess a Last War player UID / game UID.",
    "If the corpus does not contain the answer, say you do not know and suggest approving more meeting notes.",
    "Cite sources by their numbered context tags when you rely on them.",
    "Reply in the same language as the officer's question.",
    "Keep answers concise and operational.",
  ].join(" ");
}

export function truncateTranscriptForSynthesis(transcript: string): string {
  if (transcript.length <= MAX_SYNTHESIZE_TRANSCRIPT_CHARS) return transcript;
  return `${transcript.slice(0, MAX_SYNTHESIZE_TRANSCRIPT_CHARS)}\n\n[Transcript truncated for synthesis.]`;
}
