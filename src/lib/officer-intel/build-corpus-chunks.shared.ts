/** Approximate chars per token for chunk sizing (~4). */
export const OFFICER_INTEL_CHARS_PER_TOKEN = 4;

export const OFFICER_INTEL_CHUNK_MIN_CHARS =
  300 * OFFICER_INTEL_CHARS_PER_TOKEN;
export const OFFICER_INTEL_CHUNK_MAX_CHARS =
  800 * OFFICER_INTEL_CHARS_PER_TOKEN;

export type OfficerIntelSessionContext = {
  title: string;
  channelLabel: string | null;
  sessionAt: string | null;
};

export type OfficerIntelApprovedNoteInput = {
  summary: string;
  keyDecisions: string[];
  openQuestions: string[];
};

export type OfficerIntelActionItemChunkInput = {
  title: string;
  description: string | null;
  assigneeMemberName: string | null;
  assigneeNameRaw: string | null;
  dueAt: string | null;
  dueHint: string | null;
};

export function buildSessionMetadataLine(
  session: OfficerIntelSessionContext,
): string {
  const parts = [`Session: ${session.title}`];
  if (session.channelLabel) {
    parts.push(`Channel: ${session.channelLabel}`);
  }
  if (session.sessionAt) {
    parts.push(`Date: ${session.sessionAt}`);
  }
  return parts.join(" | ");
}

function splitOnParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function splitOnSentences(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  return (parts ?? [text]).map((part) => part.trim()).filter(Boolean);
}

export function splitTextIntoChunks(
  text: string,
  minChars = OFFICER_INTEL_CHUNK_MIN_CHARS,
  maxChars = OFFICER_INTEL_CHUNK_MAX_CHARS,
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const paragraphs = splitOnParagraphs(trimmed);
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    const next = current.trim();
    if (next) chunks.push(next);
    current = "";
  };

  const appendUnit = (unit: string) => {
    const candidate = current ? `${current}\n\n${unit}` : unit;
    if (candidate.length <= maxChars) {
      current = candidate;
      return;
    }
    if (current) flush();
    if (unit.length <= maxChars) {
      current = unit;
      return;
    }
    const sentences = splitOnSentences(unit);
    if (sentences.length <= 1 && unit.length > maxChars) {
      for (let offset = 0; offset < unit.length; offset += maxChars) {
        appendUnit(unit.slice(offset, offset + maxChars));
      }
      return;
    }
    for (const sentence of sentences) {
      appendUnit(sentence);
    }
  };

  for (const paragraph of paragraphs) {
    appendUnit(paragraph);
    if (current.length >= minChars) flush();
  }
  flush();

  if (chunks.length === 0) {
    return [trimmed.slice(0, maxChars)];
  }

  const merged: string[] = [];
  for (const chunk of chunks) {
    const prev = merged.at(-1);
    if (prev && prev.length < minChars && prev.length + 2 + chunk.length <= maxChars) {
      merged[merged.length - 1] = `${prev}\n\n${chunk}`;
    } else {
      merged.push(chunk);
    }
  }

  return merged;
}

export function buildApprovedNoteCorpusBody(
  note: OfficerIntelApprovedNoteInput,
): string {
  const sections = [note.summary.trim()];
  if (note.keyDecisions.length > 0) {
    sections.push(
      "Key decisions:\n" +
        note.keyDecisions.map((entry) => `- ${entry}`).join("\n"),
    );
  }
  if (note.openQuestions.length > 0) {
    sections.push(
      "Open questions:\n" +
        note.openQuestions.map((entry) => `- ${entry}`).join("\n"),
    );
  }
  return sections.filter(Boolean).join("\n\n");
}

export function buildApprovedNoteChunks(input: {
  note: OfficerIntelApprovedNoteInput;
  session: OfficerIntelSessionContext;
}): string[] {
  const metadata = buildSessionMetadataLine(input.session);
  const body = buildApprovedNoteCorpusBody(input.note);
  const bodyChunks = splitTextIntoChunks(body);
  if (bodyChunks.length === 0) {
    return [`${metadata}\n\n${input.note.summary.trim()}`];
  }
  return bodyChunks.map((chunk) => `${metadata}\n\n${chunk}`);
}

export function buildActionItemChunk(input: {
  item: OfficerIntelActionItemChunkInput;
  session?: OfficerIntelSessionContext | null;
}): string {
  const lines = [input.item.title.trim()];
  if (input.item.description?.trim()) {
    lines.push(input.item.description.trim());
  }
  const assignee =
    input.item.assigneeMemberName?.trim() ||
    input.item.assigneeNameRaw?.trim() ||
    null;
  if (assignee) {
    lines.push(`Assignee: ${assignee}`);
  }
  const due =
    input.item.dueAt?.trim() ||
    input.item.dueHint?.trim() ||
    null;
  if (due) {
    lines.push(`Due: ${due}`);
  }

  const body = lines.join("\n");
  if (input.session) {
    return `${buildSessionMetadataLine(input.session)}\n\n${body}`;
  }
  return body;
}
