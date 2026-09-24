"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { preventDefaultFormSubmit } from "@/lib/client/form-enter-submit.shared";

export type OpenRoleNudge = {
  id: string;
  kind: string;
  fromRank: number | null;
  toRank: number | null;
  memberName: string;
  canAct: boolean;
  createdAt: string;
};

export type RoleHistoryItem = {
  id: string;
  type: "nudge" | "role_change" | "rank_change";
  at: string;
  summary: Record<string, unknown>;
};

type AcceptResult = {
  kind?: string;
  inviteUrl?: string;
  passphrase?: string;
  error?: string;
};

type Props = {
  initialOpen: OpenRoleNudge[];
  initialHistory: RoleHistoryItem[];
};

export function TeamRoleNudgesPanel({
  initialOpen,
  initialHistory,
}: Props) {
  const t = useTranslations("team.roleNudges");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("nudge");

  const [open, setOpen] = useState(initialOpen);
  const [history, setHistory] = useState(initialHistory);
  const [historyOpen, setHistoryOpen] = useState(Boolean(highlightId));
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [inviteResult, setInviteResult] = useState<AcceptResult | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/settings/team/role-nudges");
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? t("loadFailed"));
        return;
      }
      const data = (await res.json()) as {
        open: OpenRoleNudge[];
        history: RoleHistoryItem[];
      };
      setOpen(data.open);
      setHistory(data.history);
    } catch {
      setError(t("loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    if (!highlightId) return;
    const el = document.getElementById(`role-nudge-${highlightId}`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [highlightId, open]);

  async function act(nudgeId: string, action: "accept" | "reject") {
    setBusyId(nudgeId);
    setError(null);
    setInviteResult(null);
    try {
      const res = await fetch(
        `/api/settings/team/role-nudges/${encodeURIComponent(nudgeId)}/${action}`,
        { method: "POST" },
      );
      const data = (await res.json().catch(() => ({}))) as AcceptResult & {
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? t("actionFailed"));
        return;
      }
      if (action === "accept" && data.kind === "escalate_invite") {
        setInviteResult(data);
      }
      await reload();
    } catch {
      setError(t("actionFailed"));
    } finally {
      setBusyId(null);
    }
  }

  function kindLabel(kind: string): string {
    if (kind === "escalate_invite") return t("kindEscalateInvite");
    if (kind === "escalate_elevate") return t("kindEscalateElevate");
    if (kind === "deescalate") return t("kindDeescalate");
    return kind;
  }

  function statusLabel(status: string): string {
    if (status === "open") return t("statusOpen");
    if (status === "accepted") return t("statusAccepted");
    if (status === "rejected") return t("statusRejected");
    if (status === "superseded") return t("statusSuperseded");
    return status;
  }

  function historyLabel(item: RoleHistoryItem): string {
    if (item.type === "nudge") {
      const kind = String(item.summary.kind ?? "");
      const status = String(item.summary.status ?? "");
      const name = String(item.summary.memberName ?? "");
      return t("historyNudge", {
        name,
        kind: kindLabel(kind),
        status: statusLabel(status),
      });
    }
    if (item.type === "role_change") {
      return t("historyRole", {
        name: String(
          item.summary.displayName ?? item.summary.email ?? item.summary.hqUserId,
        ),
        from: String(item.summary.fromRole ?? "—"),
        to: String(item.summary.toRole ?? "—"),
      });
    }
    return t("historyRank", {
      name: String(item.summary.memberName ?? ""),
      rank: String(item.summary.allianceRank ?? "—"),
    });
  }

  if (open.length === 0 && history.length === 0 && !error) {
    return null;
  }

  return (
    <section className="space-y-3 rounded-xl border border-hq-border bg-hq-surface p-4">
      <div>
        <h2 className="text-sm font-semibold text-hq-fg">{t("title")}</h2>
        <p className="mt-1 text-xs text-hq-fg-muted">{t("description")}</p>
      </div>

      {error ? (
        <p className="text-sm text-hq-danger" role="alert">
          {error}
        </p>
      ) : null}

      {inviteResult?.inviteUrl ? (
        <div className="rounded-lg border border-hq-success/40 bg-hq-success/10 p-3 text-sm text-hq-fg">
          <p className="font-medium">{t("inviteCreated")}</p>
          <p className="mt-1 break-all text-xs text-hq-fg-muted">
            {inviteResult.inviteUrl}
          </p>
          {inviteResult.passphrase ? (
            <p className="mt-1 text-xs">
              {t("invitePassphrase", { passphrase: inviteResult.passphrase })}
            </p>
          ) : null}
        </div>
      ) : null}

      {open.length === 0 ? (
        <p className="text-sm text-hq-fg-muted">{t("emptyOpen")}</p>
      ) : (
        <ul className="space-y-3">
          {open.map((nudge) => {
            const highlighted = highlightId === nudge.id;
            return (
              <li
                key={nudge.id}
                id={`role-nudge-${nudge.id}`}
                className={
                  highlighted
                    ? "rounded-lg border border-hq-accent bg-hq-accent/10 p-3"
                    : "rounded-lg border border-hq-border p-3"
                }
              >
                <p className="text-sm font-medium text-hq-fg">
                  {nudge.memberName}
                </p>
                <p className="mt-1 text-xs text-hq-fg-muted">
                  {kindLabel(nudge.kind)} · R{nudge.fromRank ?? "?"}→R
                  {nudge.toRank ?? "?"}
                </p>
                {nudge.canAct ? (
                <form
                  className="mt-3 flex flex-wrap gap-2"
                  onSubmit={(event) => {
                    preventDefaultFormSubmit(event);
                    void act(nudge.id, "accept");
                  }}
                >
                  <button
                    type="submit"
                    disabled={busyId === nudge.id}
                    className="rounded-md bg-hq-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                  >
                    {busyId === nudge.id ? t("working") : t("accept")}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === nudge.id}
                    onClick={() => void act(nudge.id, "reject")}
                    className="rounded-md border border-hq-border px-3 py-1.5 text-xs text-hq-fg-muted hover:text-hq-fg disabled:opacity-50"
                  >
                    {t("reject")}
                  </button>
                </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <div>
        <button
          type="button"
          onClick={() => setHistoryOpen((v) => !v)}
          className="text-xs font-medium text-hq-accent hover:underline"
        >
          {historyOpen ? t("hideHistory") : t("showHistory")}
        </button>
        {historyOpen ? (
          <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto text-xs text-hq-fg-muted">
            {history.length === 0 ? (
              <li>{t("emptyHistory")}</li>
            ) : (
              history.map((item) => (
                <li key={item.id} className="border-t border-hq-border pt-2">
                  <span className="text-hq-fg-subtle">
                    {new Date(item.at).toLocaleString(locale)}
                  </span>
                  <div className="text-hq-fg">{historyLabel(item)}</div>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
