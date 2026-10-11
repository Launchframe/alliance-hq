"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { AppSelect } from "@/components/ui/AppSelect";
import {
  isCommanderTransferErrorCode,
  type CommanderTransferSummary,
} from "@/lib/admin/commander-transfer.shared";
import { preventDefaultFormSubmit } from "@/lib/client/form-enter-submit.shared";

type AllianceOption = { id: string; name: string; slug: string };
type CandidateMember = { ashedMemberId: string; currentName: string };

export function AdminCommanderTransferPanel({
  hqUserId,
  commanderId,
  alliances,
  onTransferred,
}: {
  hqUserId: string;
  commanderId: string;
  alliances: AllianceOption[];
  onTransferred: () => void | Promise<void>;
}) {
  const t = useTranslations("admin.usersPage.transfer");
  const [open, setOpen] = useState(false);
  const [allianceId, setAllianceId] = useState("");
  const [members, setMembers] = useState<CandidateMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [ashedMemberId, setAshedMemberId] = useState("");
  const [preview, setPreview] = useState<CommanderTransferSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function errorMessage(code: unknown): string {
    return isCommanderTransferErrorCode(code) ? t(`errors.${code}`) : t("failed");
  }

  async function chooseAlliance(nextAllianceId: string) {
    setAllianceId(nextAllianceId);
    setAshedMemberId("");
    setPreview(null);
    setError(null);
    setMembers([]);
    if (!nextAllianceId) return;
    setMembersLoading(true);
    try {
      const res = await fetch(
        `/api/admin/commander-transfer?allianceId=${encodeURIComponent(nextAllianceId)}`,
      );
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { members: CandidateMember[] };
      setMembers(data.members);
    } catch {
      setError(t("failed"));
    } finally {
      setMembersLoading(false);
    }
  }

  async function submit(dryRun: boolean) {
    if (!allianceId || !ashedMemberId) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/commander-transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hqUserId,
          commanderId,
          destinationAllianceId: allianceId,
          destinationAshedMemberId: ashedMemberId,
          dryRun,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        summary?: CommanderTransferSummary;
      } | null;
      if (!res.ok || !data?.summary) {
        setPreview(null);
        setError(errorMessage(data?.error));
        return;
      }
      if (dryRun) {
        setPreview(data.summary);
        return;
      }
      setPreview(null);
      setOpen(false);
      setMessage(t("success"));
      await onTransferred();
    } catch {
      setError(t("failed"));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="space-y-1">
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setMessage(null);
          }}
          className="rounded-lg border border-hq-border px-3 py-1.5 text-xs text-hq-fg hover:border-hq-accent"
        >
          {t("button")}
        </button>
        {message ? <p className="text-xs text-hq-success">{message}</p> : null}
      </div>
    );
  }

  return (
    <form
      className="space-y-3 rounded-md border border-hq-border/70 bg-hq-canvas p-3"
      onSubmit={(event) => {
        preventDefaultFormSubmit(event);
        void submit(preview == null);
      }}
    >
      <div>
        <p className="text-sm font-medium">{t("title")}</p>
        <p className="mt-1 text-xs text-hq-fg-muted">{t("hint")}</p>
      </div>
      <label className="block text-sm">
        <span className="mb-1 block text-xs text-hq-fg-muted">
          {t("destinationAlliance")}
        </span>
        <AppSelect
          value={allianceId}
          onChange={(value) => void chooseAlliance(value)}
          searchable
          placeholder={t("chooseAlliance")}
          aria-label={t("destinationAlliance")}
          options={alliances.map((alliance) => ({
            value: alliance.id,
            label: `${alliance.slug} — ${alliance.name}`,
          }))}
        />
      </label>
      {allianceId && !membersLoading ? (
        members.length === 0 ? (
          <p className="text-xs text-hq-fg-muted">{t("noMembers")}</p>
        ) : (
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-hq-fg-muted">
              {t("destinationMember")}
            </span>
            <AppSelect
              value={ashedMemberId}
              onChange={(value) => {
                setAshedMemberId(value);
                setPreview(null);
                setError(null);
              }}
              searchable
              placeholder={t("chooseMember")}
              aria-label={t("destinationMember")}
              options={members.map((member) => ({
                value: member.ashedMemberId,
                label: member.currentName,
              }))}
            />
          </label>
        )
      ) : null}
      {preview ? (
        <p className="text-xs text-hq-fg">
          {t("previewSummary", {
            fromServer: preview.fromServer ?? "—",
            toServer: preview.toServer,
            memberName: preview.memberName,
            alliance: preview.allianceName,
            historyCount: preview.historyCount,
          })}
        </p>
      ) : null}
      {error ? <p className="text-xs text-hq-danger">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        {preview ? (
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg border border-hq-success bg-hq-success px-3 py-1.5 text-xs text-white disabled:opacity-50"
          >
            {t("confirm")}
          </button>
        ) : (
          <button
            type="submit"
            disabled={busy || !allianceId || !ashedMemberId}
            className="rounded-lg border border-hq-border px-3 py-1.5 text-xs text-hq-fg disabled:opacity-50"
          >
            {t("preview")}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setPreview(null);
            setError(null);
          }}
          className="rounded-lg px-3 py-1.5 text-xs text-hq-fg-muted hover:underline disabled:opacity-50"
        >
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}
