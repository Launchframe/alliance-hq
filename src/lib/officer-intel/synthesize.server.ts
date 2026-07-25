import "server-only";

import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";

import { matchOfficerActionItemAssignee } from "@/lib/officer-intel/assignee-match.server";
import {
  isOfficerIntelLlmConfigured,
  officerIntelLlmModel,
} from "@/lib/officer-intel/llm-config.server";
import { parseActionItemDueDate } from "@/lib/officer-intel/parse-action-item-due.shared";
import {
  listOfficerChatMessages,
  persistOfficerSynthesisResult,
} from "@/lib/officer-intel/repository.server";
import { officerSynthesisOutputSchema } from "@/lib/officer-intel/synthesis-types.shared";

function formatTranscript(
  messages: Awaited<ReturnType<typeof listOfficerChatMessages>>,
): string {
  return messages
    .map((message) => {
      const tag = message.senderAllianceTag
        ? `[${message.senderAllianceTag}] `
        : "";
      const reply =
        message.isReply && message.replyToName
          ? `(reply to ${message.replyToName}) `
          : "";
      return `${tag}${message.senderName}: ${reply}${message.localeText}`;
    })
    .join("\n");
}

export async function synthesizeOfficerMeetingNote(input: {
  sessionId: string;
  allianceId: string;
  hqUserId: string | null;
  sessionTitle: string;
  channelLabel: string | null;
}): Promise<
  | { ok: true; noteId: string }
  | { error: "not_configured" | "no_messages" | "not_found" | "approved" }
> {
  if (!isOfficerIntelLlmConfigured()) {
    return { error: "not_configured" };
  }

  const messages = await listOfficerChatMessages({
    sessionId: input.sessionId,
    allianceId: input.allianceId,
  });
  if (messages.length === 0) {
    return { error: "no_messages" };
  }

  const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const modelId = officerIntelLlmModel();
  const transcript = formatTranscript(messages);

  const { object } = await generateObject({
    model: openai(modelId),
    schema: officerSynthesisOutputSchema,
    prompt: [
      "You are an alliance officer assistant summarizing in-game officer chat.",
      "Produce concise meeting notes and actionable follow-ups for R4/R5 leadership.",
      "Use the same language as the chat transcript.",
      "For action items, extract assignee in-game names when mentioned.",
      "For dueDate, prefer ISO dates (YYYY-MM-DD) when a date is explicit; otherwise short hints like 'tomorrow'.",
      "",
      `Session title: ${input.sessionTitle}`,
      input.channelLabel ? `Channel: ${input.channelLabel}` : "",
      "",
      "Chat transcript:",
      transcript,
    ]
      .filter(Boolean)
      .join("\n"),
  });

  const actionItems = [];
  for (const item of object.actionItems) {
    const assignee = await matchOfficerActionItemAssignee({
      allianceId: input.allianceId,
      assigneeName: item.assigneeName,
    });
    const due = parseActionItemDueDate(item.dueDate);
    actionItems.push({
      title: item.title.trim(),
      description: item.description?.trim() || null,
      priority: item.priority,
      assigneeAllianceMemberId: assignee.allianceMemberId,
      assigneeNameRaw: item.assigneeName?.trim() || null,
      dueAt: due.dueAt,
      dueHint: due.dueHint,
    });
  }

  const result = await persistOfficerSynthesisResult({
    sessionId: input.sessionId,
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    modelId,
    summary: object.summary.trim(),
    keyDecisions: object.keyDecisions.map((entry) => entry.trim()).filter(Boolean),
    openQuestions: object.openQuestions.map((entry) => entry.trim()).filter(Boolean),
    actionItems,
  });

  if ("error" in result) {
    return result;
  }

  return { ok: true, noteId: result.noteId };
}
