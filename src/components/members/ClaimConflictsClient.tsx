"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

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
  const [conflicts, setConflicts] = useState(initialConflicts);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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
    try {
      const res = await fetch(`/api/members/claim-conflicts/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
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

              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  disabled={busyId === conflict.id}
                  onClick={() => void resolve(conflict.id, "resolve")}
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
