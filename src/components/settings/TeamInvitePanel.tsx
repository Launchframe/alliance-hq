"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { CopyToClipboardField } from "@/components/ui/CopyToClipboardField";
import { Link } from "@/i18n/navigation";
import type { SystemRoleName } from "@/lib/rbac/constants";

function isValidInviteEmail(value: string): boolean {
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

type InviteKind = "email" | "protected_link";

type ActionFeedback = {
  kind: "error" | "success";
  text: string;
} | null;

function ActionFeedbackBanner({ feedback }: { feedback: ActionFeedback }) {
  if (!feedback) {
    return null;
  }

  return (
    <p
      className={
        feedback.kind === "error"
          ? "mt-3 text-sm text-[#f85149]"
          : "mt-3 text-sm text-[#3fb950]"
      }
      role={feedback.kind === "error" ? "alert" : "status"}
    >
      {feedback.text}
    </p>
  );
}

const ROLE_LABEL_KEYS: Record<
  SystemRoleName,
  | "roleOfficer"
  | "roleDataEntry"
  | "roleViewer"
  | "roleMember"
  | "roleOwner"
  | "roleMaintainer"
> = {
  owner: "roleOwner",
  maintainer: "roleMaintainer",
  officer: "roleOfficer",
  data_entry: "roleDataEntry",
  viewer: "roleViewer",
  member: "roleMember",
};

type Props = {
  assignableRoles: SystemRoleName[];
  gameServerNumber: number | null;
  allianceTag: string;
};

export function TeamInvitePanel({
  assignableRoles,
  gameServerNumber,
  allianceTag,
}: Props) {
  const t = useTranslations("team.invites");
  const [inviteKind, setInviteKind] = useState<InviteKind>("protected_link");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteAdminLabel, setInviteAdminLabel] = useState("");
  const [inviteRedirectPath, setInviteRedirectPath] = useState("");
  const [inviteRole, setInviteRole] = useState<SystemRoleName | "">("");
  const [joinCodeRole, setJoinCodeRole] = useState<SystemRoleName>("member");
  const [joinCodeMaxUses, setJoinCodeMaxUses] = useState("10");
  const [joinCodeLabel, setJoinCodeLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);
  const [lastPassphrase, setLastPassphrase] = useState<string | null>(null);
  const [lastJoinCode, setLastJoinCode] = useState<string | null>(null);
  const [inviteFeedback, setInviteFeedback] = useState<ActionFeedback>(null);
  const [joinCodeFeedback, setJoinCodeFeedback] = useState<ActionFeedback>(null);

  const roleOptions = useMemo(
    () =>
      assignableRoles.map((role) => ({
        value: role,
        label: t(ROLE_LABEL_KEYS[role]),
      })),
    [assignableRoles, t],
  );

  const defaultInviteRole = assignableRoles.includes("member")
    ? "member"
    : (assignableRoles[0] ?? "");

  const inviteEmailValid = isValidInviteEmail(inviteEmail);
  const canSendInvite =
    gameServerNumber != null &&
    inviteRole !== "" &&
    (inviteKind === "protected_link" ||
      (inviteKind === "email" && inviteEmailValid));

  async function sendInvite() {
    if (!canSendInvite) {
      setInviteFeedback({
        kind: "error",
        text:
          inviteRole === ""
            ? t("inviteRoleRequired")
            : t("inviteEmailRequired"),
      });
      return;
    }

    setBusy(true);
    setInviteFeedback(null);
    setLastInviteUrl(null);
    setLastPassphrase(null);

    try {
      const res = await fetch("/api/settings/team/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: inviteKind,
          email: inviteKind === "email" ? inviteEmail : undefined,
          roleName: inviteRole,
          redirectPath: inviteRedirectPath.trim() || undefined,
          adminLabel: inviteAdminLabel.trim() || undefined,
        }),
      });
      const body = (await res.json()) as {
        error?: string;
        invite?: { inviteUrl: string; passphrase?: string };
      };
      if (!res.ok) {
        throw new Error(body.error ?? t("inviteFailed"));
      }
      setLastInviteUrl(body.invite?.inviteUrl ?? null);
      setLastPassphrase(body.invite?.passphrase ?? null);
      setInviteRole(defaultInviteRole);
      setInviteFeedback({ kind: "success", text: t("inviteSent") });
    } catch (error) {
      setInviteFeedback({
        kind: "error",
        text: error instanceof Error ? error.message : t("inviteFailed"),
      });
    } finally {
      setBusy(false);
    }
  }

  async function createJoinCode() {
    const maxRedemptions = Number.parseInt(joinCodeMaxUses, 10);
    if (!Number.isFinite(maxRedemptions) || maxRedemptions < 1) {
      setJoinCodeFeedback({ kind: "error", text: t("joinCodeMaxUsesInvalid") });
      return;
    }

    setBusy(true);
    setJoinCodeFeedback(null);
    setLastJoinCode(null);

    try {
      const res = await fetch("/api/settings/team/join-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roleName: joinCodeRole,
          maxRedemptions,
          adminLabel: joinCodeLabel.trim() || undefined,
        }),
      });
      const body = (await res.json()) as {
        error?: string;
        joinCode?: { code: string };
      };
      if (!res.ok) {
        throw new Error(body.error ?? t("joinCodeFailed"));
      }
      setLastJoinCode(body.joinCode?.code ?? null);
      setJoinCodeFeedback({ kind: "success", text: t("joinCodeCreated") });
    } catch (error) {
      setJoinCodeFeedback({
        kind: "error",
        text: error instanceof Error ? error.message : t("joinCodeFailed"),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8 rounded-xl border border-[#30363d] bg-[#161b22] p-5">
      <div>
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="mt-1 text-sm text-[#8b949e]">{t("description")}</p>
      </div>

      {gameServerNumber == null ? (
        <div
          className="rounded-lg border border-[#9e6a03] bg-[#9e6a03]/10 p-4 text-sm text-[#e3b341]"
          role="alert"
        >
          <p>{t("serverRequired")}</p>
          {allianceTag ? (
            <Link
              href={`/alliance/${encodeURIComponent(allianceTag)}/settings`}
              className="mt-2 inline-block text-[#58a6ff] underline"
            >
              {t("serverRequiredLink")}
            </Link>
          ) : null}
        </div>
      ) : null}

      <div className="border-t border-[#30363d] pt-5">
        <h3 className="text-sm font-semibold">{t("inviteTitle")}</h3>
        <p className="mt-1 text-sm text-[#8b949e]">{t("inviteHint")}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="text-[#8b949e]">{t("inviteKind")}</span>
            <select
              value={inviteKind}
              onChange={(e) => setInviteKind(e.target.value as InviteKind)}
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
            >
              <option value="protected_link">{t("inviteKindProtected")}</option>
              <option value="email">{t("inviteKindEmail")}</option>
            </select>
          </label>
          {inviteKind === "email" ? (
            <label className="space-y-1 text-sm">
              <span className="text-[#8b949e]">{t("inviteEmail")}</span>
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
                autoComplete="email"
              />
              <span className="block text-xs text-[#6e7681]">
                {t("inviteEmailHint")}
              </span>
            </label>
          ) : (
            <label className="space-y-1 text-sm">
              <span className="text-[#8b949e]">{t("inviteAdminLabel")}</span>
              <input
                type="text"
                value={inviteAdminLabel}
                onChange={(e) => setInviteAdminLabel(e.target.value)}
                placeholder={t("inviteAdminLabelPlaceholder")}
                className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
              />
            </label>
          )}
          <label className="space-y-1 text-sm">
            <span className="text-[#8b949e]">{t("inviteRole")}</span>
            <select
              value={inviteRole}
              onChange={(e) =>
                setInviteRole(e.target.value as SystemRoleName | "")
              }
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
            >
              <option value="">{t("inviteRolePlaceholder")}</option>
              {roleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="text-[#8b949e]">{t("inviteRedirectOptional")}</span>
            <input
              type="text"
              value={inviteRedirectPath}
              onChange={(e) => setInviteRedirectPath(e.target.value)}
              placeholder="/members"
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 font-mono text-sm"
            />
            <span className="block text-xs text-[#6e7681]">
              {t("inviteRedirectHint")}
            </span>
          </label>
        </div>
        <button
          type="button"
          disabled={busy || !canSendInvite}
          onClick={() => void sendInvite()}
          className="mt-3 rounded-lg border border-[#388bfd] bg-[#388bfd]/10 px-4 py-2 text-sm text-[#58a6ff] disabled:opacity-50"
        >
          {t("inviteButton")}
        </button>
        <ActionFeedbackBanner feedback={inviteFeedback} />
        {lastInviteUrl ? (
          <CopyToClipboardField
            className="mt-3"
            label={t("inviteLinkLabel")}
            value={lastInviteUrl}
          />
        ) : null}
        {lastPassphrase ? (
          <CopyToClipboardField
            className="mt-3"
            label={t("invitePassphraseLabel")}
            value={lastPassphrase}
          />
        ) : null}
        {lastPassphrase ? (
          <p className="mt-1 text-xs text-[#6e7681]">{t("invitePassphraseHint")}</p>
        ) : null}
      </div>

      <div className="border-t border-[#30363d] pt-5">
        <h3 className="text-sm font-semibold">{t("joinCodeTitle")}</h3>
        <p className="mt-1 text-sm text-[#8b949e]">{t("joinCodeHint")}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-[#8b949e]">{t("joinCodeRole")}</span>
            <select
              value={joinCodeRole}
              onChange={(e) =>
                setJoinCodeRole(e.target.value as SystemRoleName)
              }
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
            >
              {roleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-[#8b949e]">{t("joinCodeMaxUses")}</span>
            <input
              type="number"
              min={1}
              max={500}
              value={joinCodeMaxUses}
              onChange={(e) => setJoinCodeMaxUses(e.target.value)}
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
            />
          </label>
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="text-[#8b949e]">{t("joinCodeLabelField")}</span>
            <input
              type="text"
              value={joinCodeLabel}
              onChange={(e) => setJoinCodeLabel(e.target.value)}
              placeholder={t("joinCodeLabelPlaceholder")}
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
            />
          </label>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void createJoinCode()}
          className="mt-3 rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {t("joinCodeButton")}
        </button>
        <ActionFeedbackBanner feedback={joinCodeFeedback} />
        {lastJoinCode ? (
          <>
            <CopyToClipboardField
              className="mt-3"
              label={t("joinCodeValueLabel")}
              value={lastJoinCode}
            />
            <p className="mt-1 text-xs text-[#6e7681]">{t("joinCodeValueHint")}</p>
          </>
        ) : null}
      </div>
    </div>
  );
}
