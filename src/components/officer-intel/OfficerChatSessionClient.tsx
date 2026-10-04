"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";

import type { OfficerChatMessageRecord } from "@/lib/officer-intel/types.shared";
import type { OfficerMeetingNoteSummary } from "@/lib/officer-intel/synthesis-types.shared";

type SessionDetail = {
  id: string;
  title: string;
  channelLabel: string | null;
  sessionAt: string | null;
  status: string;
};

type SessionImage = {
  id: string;
  sequenceOrder: number;
  href: string;
};

type Props = {
  session: SessionDetail;
  messages: OfficerChatMessageRecord[];
  images: SessionImage[];
  translationConfigured: boolean;
  llmConfigured: boolean;
  canWrite: boolean;
  meetingNote: OfficerMeetingNoteSummary | null;
};

export function OfficerChatSessionClient({
  session,
  messages,
  images,
  translationConfigured,
  llmConfigured,
  canWrite,
  meetingNote,
}: Props) {
  const t = useTranslations("officerIntel");
  const router = useRouter();
  const [synthesizing, setSynthesizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSynthesize() {
    setSynthesizing(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/officer-intel/sessions/${session.id}/synthesize`,
        { method: "POST" },
      );
      const body = (await res.json().catch(() => null)) as
        | { noteId?: string; error?: string }
        | null;
      if (!res.ok || !body?.noteId) {
        setError(body?.error ?? t("synthesizeFailed"));
        return;
      }
      router.push(`/officer-intel/notes/${body.noteId}`);
      router.refresh();
    } catch {
      setError(t("synthesizeFailed"));
    } finally {
      setSynthesizing(false);
    }
  }

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-6 px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/officer-intel"
            className="text-sm text-hq-accent hover:underline"
          >
            {t("backToHub")}
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-hq-fg">
            {session.title}
          </h1>
          <p className="text-sm text-hq-muted">
            {session.channelLabel ?? t("channelUnknown")} ·{" "}
            {t("messageCount", { count: messages.length })}
          </p>
        </div>
        {canWrite && session.status === "imported" ? (
          <div className="flex flex-col items-end gap-2">
            <button
              type="button"
              disabled={synthesizing || !llmConfigured}
              onClick={() => void handleSynthesize()}
              className="rounded-lg bg-hq-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {synthesizing ? t("synthesizing") : t("synthesizeNotes")}
            </button>
            {meetingNote ? (
              <Link
                href={`/officer-intel/notes/${meetingNote.id}`}
                className="text-sm text-hq-accent hover:underline"
              >
                {t("viewMeetingNotes")}
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>

      {!translationConfigured ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          {t("translationUnavailable")}
        </p>
      ) : null}

      {canWrite && !llmConfigured ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          {t("llmUnavailable")}
        </p>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}

      {images.length > 0 ? (
        <section className="rounded-xl border border-hq-border bg-hq-surface p-4">
          <h2 className="mb-3 text-sm font-semibold">{t("sourceScreenshots")}</h2>
          <div className="flex flex-wrap gap-3">
            {images.map((image) => (
              <a
                key={image.id}
                href={image.href}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-hq-accent hover:underline"
              >
                {t("screenshotNumber", { number: image.sequenceOrder + 1 })}
              </a>
            ))}
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        {messages.map((message) => (
          <article
            key={message.id}
            className="rounded-xl border border-hq-border bg-hq-surface p-4"
          >
            <header className="mb-2 text-sm font-medium text-hq-fg">
              {message.isReply && message.replyToName
                ? t("replyTo", { name: message.replyToName })
                : null}{" "}
              {message.senderAllianceTag
                ? `[${message.senderAllianceTag}]`
                : ""}
              {message.senderName}
              {message.senderLevel != null ? ` · Lv.${message.senderLevel}` : ""}
            </header>
            <p className="whitespace-pre-wrap text-sm text-hq-fg">
              {message.localeText}
            </p>
            {message.inGameTranslatedText &&
            message.inGameTranslatedText !== message.localeText ? (
              <details className="mt-3 text-sm text-hq-muted">
                <summary className="cursor-pointer">
                  {t("showOriginalAndInGame")}
                </summary>
                <div className="mt-2 space-y-2">
                  <div>
                    <p className="font-medium">{t("originalText")}</p>
                    <p className="whitespace-pre-wrap">{message.originalText}</p>
                  </div>
                  <div>
                    <p className="font-medium">{t("inGameTranslation")}</p>
                    <p className="whitespace-pre-wrap">
                      {message.inGameTranslatedText}
                    </p>
                  </div>
                </div>
              </details>
            ) : message.originalText !== message.localeText ? (
              <details className="mt-3 text-sm text-hq-muted">
                <summary className="cursor-pointer">{t("originalText")}</summary>
                <p className="mt-2 whitespace-pre-wrap">{message.originalText}</p>
              </details>
            ) : null}
          </article>
        ))}
      </section>
    </div>
  );
}
