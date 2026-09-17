"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Upload } from "lucide-react";

import { OfficerChatImportPanel } from "@/components/officer-intel/OfficerChatImportPanel";
import type { OfficerIntelDashboardPayload } from "@/lib/officer-intel/types.shared";

type Props = {
  initial: OfficerIntelDashboardPayload;
};

export function OfficerIntelClient({ initial }: Props) {
  const t = useTranslations("officerIntel");
  const [sessions, setSessions] = useState(initial.sessions);
  const [importOpen, setImportOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshSessions = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/officer-intel/sessions");
    const body = (await res.json().catch(() => null)) as
      | OfficerIntelDashboardPayload
      | { error?: string }
      | null;
    if (!res.ok || !body || !("sessions" in body)) {
      setError(
        body && "error" in body && body.error
          ? body.error
          : t("loadFailed"),
      );
      return;
    }
    setSessions(body.sessions);
  }, [t]);

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-6 px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-hq-fg">{t("title")}</h1>
          <p className="mt-1 text-sm text-hq-muted">{t("subtitle")}</p>
        </div>
        {initial.canWrite ? (
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg bg-hq-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            onClick={() => setImportOpen(true)}
          >
            <Upload className="h-4 w-4" aria-hidden />
            {t("uploadChat")}
          </button>
        ) : null}
      </div>

      {!initial.translationConfigured ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-hq-fg">
          {t("translationUnavailable")}
        </p>
      ) : null}

      {initial.openActionItemCount > 0 ? (
        <section className="rounded-xl border border-hq-border bg-hq-surface px-4 py-3">
          <Link
            href="/officer-intel/action-items"
            className="text-sm font-medium text-hq-accent hover:underline"
          >
            {t("openActionItemsLink", {
              count: initial.openActionItemCount,
            })}
          </Link>
        </section>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}

      <section className="rounded-xl border border-hq-border bg-hq-surface">
        <div className="border-b border-hq-border px-4 py-3">
          <h2 className="text-sm font-semibold text-hq-fg">{t("sessionsTitle")}</h2>
        </div>
        {sessions.length === 0 ? (
          <p className="px-4 py-8 text-sm text-hq-muted">{t("noSessions")}</p>
        ) : (
          <ul className="divide-y divide-hq-border">
            {sessions.map((session) => (
              <li key={session.id}>
                <Link
                  href={`/officer-intel/sessions/${session.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-hq-muted/10"
                >
                  <div>
                    <p className="font-medium text-hq-fg">{session.title}</p>
                    <p className="text-xs text-hq-muted">
                      {session.channelLabel ?? t("channelUnknown")} ·{" "}
                      {t("messageCount", { count: session.messageCount })}
                    </p>
                  </div>
                  <span className="text-xs text-hq-muted">
                    {new Date(session.updatedAt).toLocaleString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {importOpen ? (
        <OfficerChatImportPanel
          onClose={() => setImportOpen(false)}
          onImported={async (sessionId) => {
            setImportOpen(false);
            await refreshSessions();
            window.location.assign(`/officer-intel/sessions/${sessionId}`);
          }}
        />
      ) : null}
    </div>
  );
}
