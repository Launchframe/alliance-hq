"use client";

import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Send } from "lucide-react";

import { Link } from "@/i18n/navigation";
import type {
  OfficerIntelAskCitation,
  OfficerIntelAskEvent,
} from "@/lib/officer-intel/ask-types.shared";

type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: OfficerIntelAskCitation[];
};

type Props = {
  llmConfigured: boolean;
  approvedNoteCount: number;
};

function parseAskEvent(line: string): OfficerIntelAskEvent | null {
  try {
    const parsed: unknown = JSON.parse(line);
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as { type?: unknown };
    if (
      record.type === "meta" ||
      record.type === "delta" ||
      record.type === "error" ||
      record.type === "done"
    ) {
      return parsed as OfficerIntelAskEvent;
    }
    return null;
  } catch {
    return null;
  }
}

export function OfficerIntelAskPanel({
  llmConfigured,
  approvedNoteCount,
}: Props) {
  const t = useTranslations("officerIntel");
  const [question, setQuestion] = useState("");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const scrollToEnd = useCallback(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, []);

  function citationLabel(citation: OfficerIntelAskCitation): string {
    const kind =
      citation.sourceType === "approved_note"
        ? t("askCitationNote")
        : t("askCitationActionItem");
    const extras = [
      citation.channelLabel,
      citation.sessionAt
        ? new Date(citation.sessionAt).toLocaleDateString()
        : null,
    ].filter((part): part is string => Boolean(part?.trim()));
    if (extras.length === 0) return kind;
    return [kind, ...extras].join(" · ");
  }

  async function submitQuestion(event: React.FormEvent) {
    event.preventDefault();
    const nextQuestion = question.trim();
    if (!nextQuestion || asking) return;

    setAsking(true);
    setError(null);
    setQuestion("");
    const userTurn: ChatTurn = {
      id: `user-${Date.now()}`,
      role: "user",
      content: nextQuestion,
      citations: [],
    };
    const assistantId = `assistant-${Date.now()}`;
    setTurns((prev) => [
      ...prev,
      userTurn,
      { id: assistantId, role: "assistant", content: "", citations: [] },
    ]);

    try {
      const res = await fetch("/api/officer-intel/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: nextQuestion, threadId }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? t("askFailed"));
      }
      if (!res.body) {
        throw new Error(t("askFailed"));
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const parsed = parseAskEvent(line);
          if (!parsed) continue;
          if (parsed.type === "meta") {
            setThreadId(parsed.threadId);
            setTurns((prev) =>
              prev.map((turn) =>
                turn.id === assistantId
                  ? { ...turn, citations: parsed.citations }
                  : turn,
              ),
            );
          } else if (parsed.type === "delta") {
            setTurns((prev) =>
              prev.map((turn) =>
                turn.id === assistantId
                  ? { ...turn, content: turn.content + parsed.text }
                  : turn,
              ),
            );
            scrollToEnd();
          } else if (parsed.type === "error") {
            setError(parsed.message || t("askFailed"));
          } else if (parsed.type === "done") {
            setThreadId(parsed.threadId);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("askFailed"));
    } finally {
      setAsking(false);
      scrollToEnd();
    }
  }

  return (
    <section className="rounded-xl border border-hq-border bg-hq-surface">
      <div className="border-b border-hq-border px-4 py-3">
        <h2 className="text-sm font-semibold text-hq-fg">{t("askTitle")}</h2>
        <p className="mt-1 text-sm text-hq-muted">{t("askSubtitle")}</p>
      </div>

      {!llmConfigured ? (
        <p className="px-4 py-3 text-sm text-hq-muted">{t("askLlmUnavailable")}</p>
      ) : null}

      {llmConfigured && approvedNoteCount === 0 ? (
        <p className="px-4 py-3 text-sm text-hq-muted">{t("askEmptyCorpus")}</p>
      ) : null}

      {turns.length > 0 ? (
        <div
          ref={listRef}
          className="max-h-80 space-y-3 overflow-y-auto px-4 py-3"
        >
          {turns.map((turn) => (
            <article key={turn.id} className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-hq-muted">
                {turn.role === "user" ? t("askYou") : t("askAssistant")}
              </p>
              <p className="whitespace-pre-wrap text-sm text-hq-fg">
                {turn.content || (asking ? t("asking") : "")}
              </p>
              {turn.role === "assistant" && turn.citations.length > 0 ? (
                <div>
                  <p className="text-xs font-medium text-hq-muted">
                    {t("askSources")}
                  </p>
                  <ul className="mt-1 flex flex-wrap gap-2">
                    {turn.citations.map((citation) => (
                      <li key={`${citation.sourceType}-${citation.sourceId}`}>
                        <Link
                          href={citation.href}
                          className="rounded-full border border-hq-border px-2 py-0.5 text-xs text-hq-accent hover:bg-hq-muted/10"
                        >
                          {citationLabel(citation)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}

      {error ? (
        <p className="px-4 py-2 text-sm text-hq-danger">{error}</p>
      ) : null}

      <form
        onSubmit={(event) => void submitQuestion(event)}
        className="flex flex-col gap-2 border-t border-hq-border p-4 sm:flex-row"
      >
        <label className="sr-only" htmlFor="officer-intel-ask">
          {t("askTitle")}
        </label>
        <input
          id="officer-intel-ask"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          disabled={!llmConfigured || asking}
          placeholder={t("askPlaceholder")}
          className="min-w-0 flex-1 rounded-lg border border-hq-border bg-hq-bg px-3 py-2 text-sm text-hq-fg placeholder:text-hq-muted disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!llmConfigured || asking || question.trim().length === 0}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-hq-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          <Send className="h-4 w-4" aria-hidden />
          {asking ? t("asking") : t("askSubmit")}
        </button>
      </form>
    </section>
  );
}
