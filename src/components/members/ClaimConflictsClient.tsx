"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  handleTextareaEnterSubmit,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";

export type ClaimConflictView = {
  id: string;
  commanderName: string;
  handle: string;
  reason:
    | "name_collision"
    | "commander_taken"
    | "server_mismatch"
    | "target_mismatch";
  status: "open" | "resolved" | "dismissed";
  createdAt: string;
};

export function ClaimConflictsClient({
  initialConflicts,
}: {
  initialConflicts: ClaimConflictView[];
}) {
  const t = useTranslations("claimConflicts");
  const commonT = useTranslations("common");
  const [conflicts, setConflicts] = useState(initialConflicts);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notesById, setNotesById] = useState<Record<string, string>>({});

  async function reload() {
    setError(null);
    try {
      const res = await fetch("/api/members/claim-conflicts?status=open");
      if (!res.ok) throw new Error("load");
      const json = (await res.json()) as { conflicts: ClaimConflictView[] };
      setConflicts(json.conflicts);
    } catch {
      setError(t("loadFailed"));
    }
  }

  async function resolve(id: string, action: "resolve" | "dismiss") {
    setBusyId(id);
    setError(null);
    const resolutionNote = notesById[id]?.trim();
    try {
      const res = await fetch(`/api/members/claim-conflicts/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...(resolutionNote ? { resolutionNote } : {}),
        }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? "resolve_failed");
      }
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("resolveFailed"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6 min-w-0 w-full max-w-full">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-[#8b949e]">{t("subtitle")}</p>
        <Link
          href="/members"
          className="mt-2 inline-block text-sm text-[#58a6ff] hover:underline"
        >
          {t("backToMembers")}
        </Link>
      </div>

      {error ? (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      {conflicts.length === 0 ? (
        <p className="text-sm text-[#8b949e]">{t("empty")}</p>
      ) : (
        <ul className="space-y-4">
          {conflicts.map((conflict) => (
            <li
              key={conflict.id}
              className="rounded-xl border border-[#30363d] bg-[#161b22] p-4 space-y-3 min-w-0"
            >
              <div className="min-w-0">
                <p className="font-medium">{conflict.commanderName}</p>
                <p className="text-xs text-[#8b949e] mt-1">
                  {t("claimant", { handle: conflict.handle })}
                </p>
                <p className="mt-2 inline-block rounded-lg border border-[#9e6a03] bg-[#9e6a031a] px-2 py-1 text-xs text-[#e3b341]">
                  {t(`reason.${conflict.reason}`)}
                </p>
              </div>

              <form
                className="space-y-3"
                onSubmit={(event) => {
                  preventDefaultFormSubmit(event);
                  void resolve(conflict.id, "resolve");
                }}
              >
                <label
                  htmlFor={`claim-conflict-note-${conflict.id}`}
                  className="block text-xs font-medium text-[#8b949e]"
                >
                  {commonT("note")} ({commonT("optional")})
                </label>
                <textarea
                  id={`claim-conflict-note-${conflict.id}`}
                  value={notesById[conflict.id] ?? ""}
                  onChange={(event) =>
                    setNotesById((current) => ({
                      ...current,
                      [conflict.id]: event.target.value,
                    }))
                  }
                  enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
                  onKeyDown={(event) =>
                    handleTextareaEnterSubmit(event, () => {
                      event.currentTarget.form?.requestSubmit();
                    })
                  }
                  maxLength={500}
                  rows={2}
                  disabled={busyId === conflict.id}
                  className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-[#e6edf3] disabled:opacity-50"
                />

                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="submit"
                    disabled={busyId === conflict.id}
                    className="rounded-lg bg-[#238636] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {t("markResolved")}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === conflict.id}
                    onClick={() => void resolve(conflict.id, "dismiss")}
                    className="rounded-lg border border-[#30363d] px-4 py-2 text-sm text-foreground disabled:opacity-50"
                  >
                    {t("dismiss")}
                  </button>
                </div>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
