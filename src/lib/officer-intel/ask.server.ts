import "server-only";

import { createOpenAI } from "@ai-sdk/openai";
import { generateText, isStepCount, streamText, tool } from "ai";
import { z } from "zod";

import type { OfficerIntelAskEvent } from "@/lib/officer-intel/ask-types.shared";
import {
  buildOfficerIntelAskSystemPrompt,
  citationsFromChunks,
  formatOpenActionItemsForPrompt,
  formatRetrievedChunksForPrompt,
  formatThreadSummaryForPrompt,
  shouldRefreshThreadSummary,
} from "@/lib/officer-intel/format-ask-context.shared";
import {
  isOfficerIntelLlmConfigured,
  officerIntelLlmModel,
} from "@/lib/officer-intel/llm-config.server";
import {
  listOpenActionItemsForAsk,
  loadSessionMessagesForAsk,
  retrieveOfficerIntelCorpus,
} from "@/lib/officer-intel/retrieve-corpus.server";
import {
  appendOfficerIntelThreadMessage,
  createOfficerIntelThread,
  getOfficerIntelThreadForAlliance,
  updateOfficerIntelThreadSummary,
} from "@/lib/officer-intel/thread-repository.server";

const MAX_QUESTION_CHARS = 2000;

function encodeEvent(event: OfficerIntelAskEvent): string {
  return `${JSON.stringify(event)}\n`;
}

async function refreshRunningSummary(input: {
  previousSummary: string | null;
  question: string;
  answer: string;
}): Promise<string> {
  const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const { text } = await generateText({
    model: openai(officerIntelLlmModel()),
    prompt: [
      "Update this officer-intel conversation summary. Keep it under 350 words.",
      "Preserve outstanding decisions, open questions, and named follow-ups.",
      "Do not invent facts. Never include player UIDs.",
      "",
      "Previous summary:",
      input.previousSummary?.trim() || "(none)",
      "",
      "Latest officer question:",
      input.question,
      "",
      "Latest assistant answer:",
      input.answer,
    ].join("\n"),
  });
  return text.trim();
}

export async function streamOfficerIntelAsk(input: {
  allianceId: string;
  hqUserId: string | null;
  question: string;
  threadId?: string | null;
}): Promise<Response> {
  const question = input.question.trim();
  if (!question) {
    return Response.json({ error: "Question is required." }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return Response.json({ error: "Question is too long." }, { status: 400 });
  }
  if (!isOfficerIntelLlmConfigured()) {
    return Response.json(
      { error: "LLM synthesis is not configured." },
      { status: 503 },
    );
  }

  let threadId = input.threadId?.trim() || null;
  if (threadId) {
    const existing = await getOfficerIntelThreadForAlliance({
      threadId,
      allianceId: input.allianceId,
    });
    if (!existing) {
      return Response.json({ error: "Thread not found." }, { status: 404 });
    }
  } else {
    threadId = await createOfficerIntelThread({
      allianceId: input.allianceId,
      hqUserId: input.hqUserId,
    });
  }

  const thread = await getOfficerIntelThreadForAlliance({
    threadId,
    allianceId: input.allianceId,
  });
  if (!thread) {
    return Response.json({ error: "Thread not found." }, { status: 404 });
  }

  const [chunks, actionItems] = await Promise.all([
    retrieveOfficerIntelCorpus({
      allianceId: input.allianceId,
      query: question,
    }),
    listOpenActionItemsForAsk(input.allianceId),
  ]);
  const citations = citationsFromChunks(chunks);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: OfficerIntelAskEvent) => {
        controller.enqueue(encoder.encode(encodeEvent(event)));
      };

      try {
        send({ type: "meta", threadId: thread.id, citations });

        const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const result = streamText({
          model: openai(officerIntelLlmModel()),
          system: buildOfficerIntelAskSystemPrompt(),
          tools: {
            loadSessionMessages: tool({
              description:
                "Load recent localized messages from one imported chat session when the officer asks for a verbatim quote or the retrieved notes are not enough. Only call this for a sessionId present in the retrieved context.",
              inputSchema: z.object({
                sessionId: z.string().min(1),
                limit: z.number().int().min(1).max(80).optional(),
              }),
              execute: async ({ sessionId, limit }) => {
                const allowed = new Set(
                  chunks
                    .map((chunk) => chunk.sessionId)
                    .filter((id): id is string => Boolean(id)),
                );
                if (!allowed.has(sessionId)) {
                  return {
                    error:
                      "That session is not in the retrieved notes. Answer from approved notes instead.",
                  };
                }
                const messages = await loadSessionMessagesForAsk({
                  allianceId: input.allianceId,
                  sessionId,
                  limit,
                });
                return { sessionId, messages };
              },
            }),
          },
          stopWhen: isStepCount(3),
          prompt: [
            "Conversation summary:",
            formatThreadSummaryForPrompt(thread.runningSummary),
            "",
            "Retrieved approved corpus:",
            formatRetrievedChunksForPrompt(chunks),
            "",
            "Open action items:",
            formatOpenActionItemsForPrompt(actionItems),
            "",
            "Officer question:",
            question,
          ].join("\n"),
        });

        let answer = "";
        for await (const delta of result.textStream) {
          if (!delta) continue;
          answer += delta;
          send({ type: "delta", text: delta });
        }

        await appendOfficerIntelThreadMessage({
          threadId: thread.id,
          allianceId: input.allianceId,
          role: "user",
          content: question,
        });
        await appendOfficerIntelThreadMessage({
          threadId: thread.id,
          allianceId: input.allianceId,
          role: "assistant",
          content: answer,
          citations,
        });

        const nextTurnCount = thread.turnCount + 1;
        let nextSummary = thread.runningSummary;
        if (shouldRefreshThreadSummary(nextTurnCount) && answer.trim()) {
          try {
            nextSummary = await refreshRunningSummary({
              previousSummary: thread.runningSummary,
              question,
              answer,
            });
          } catch (error) {
            console.error("officer-intel thread summary failed", error);
          }
        }
        await updateOfficerIntelThreadSummary({
          threadId: thread.id,
          allianceId: input.allianceId,
          runningSummary: nextSummary,
          turnCount: nextTurnCount,
        });

        send({ type: "done", threadId: thread.id });
      } catch (error) {
        console.error("officer-intel ask failed", error);
        send({ type: "error", message: "Could not answer that question." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
