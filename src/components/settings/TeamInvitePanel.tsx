"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { CopyToClipboardField } from "@/components/ui/CopyToClipboardField";
import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";
import { Link } from "@/i18n/navigation";
import { allianceSettingsPath } from "@/lib/alliance/alliance-settings-path.shared";
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

  const [claimableCommanders, setClaimableCommanders] = useState<
    Array<{ ashedMemberId: string; name: string }>
  >([]);
  const [claimCommanderSelected, setClaimCommanderSelected] = useState("");
  const [claimAdminLabel, setClaimAdminLabel] = useState("");
  const [claimFeedback, setClaimFeedback] = useState<ActionFeedback>(null);
  const [lastClaimUrl, setLastClaimUrl] = useState<string | null>(null);
  const [lastClaimPassphrase, setLastClaimPassphrase] = useState<string | null>(null);

  const [bulkClaimMode, setBulkClaimMode] = useState(false);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
  const [bulkClaimAdminLabel, setBulkClaimAdminLabel] = useState("");
  const [bulkClaimFeedback, setBulkClaimFeedback] = useState<ActionFeedback>(null);
  const [bulkClaimResults, setBulkClaimResults] = useState<
    Array<{ ashedMemberId: string; name: string; inviteUrl: string; passphrase: string | null }>
  >([]);

  useEffect(() => {
    void fetch("/api/settings/team/claimable-commanders")
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (data: { commanders?: Array<{ ashedMemberId: string; name: string }> } | null) => {
          setClaimableCommanders(data?.commanders ?? []);
        },
      )
      .catch(() => undefined);
  }, []);

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

  async function sendClaimInvite() {
    if (!claimCommanderSelected || gameServerNumber == null) return;

    setBusy(true);
    setClaimFeedback(null);
    setLastClaimUrl(null);
    setLastClaimPassphrase(null);

    const selectedCommander = claimableCommanders.find(
      (c) => c.ashedMemberId === claimCommanderSelected,
    );

    try {
      const res = await fetch("/api/settings/team/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "protected_link",
          roleName: "member",
          targetAshedMemberId: claimCommanderSelected,
          adminLabel: claimAdminLabel.trim() || undefined,
        }),
      });
      const body = (await res.json()) as {
        error?: string;
        code?: string;
        invite?: {
          inviteUrl: string;
          passphrase?: string;
          targetCommanderName?: string | null;
        };
      };
      if (!res.ok) {
        if (body.code === "commander_already_claimed") {
          setClaimFeedback({ kind: "error", text: t("claimAlreadyClaimed") });
          void fetch("/api/settings/team/claimable-commanders")
            .then((r) => (r.ok ? r.json() : null))
            .then(
              (data: { commanders?: Array<{ ashedMemberId: string; name: string }> } | null) => {
                setClaimableCommanders(data?.commanders ?? []);
                setClaimCommanderSelected("");
              },
            )
            .catch(() => undefined);
        } else {
          setClaimFeedback({
            kind: "error",
            text: body.error ?? t("claimFailed"),
          });
        }
        return;
      }
      const displayName =
        body.invite?.targetCommanderName ?? selectedCommander?.name ?? "";
      setLastClaimUrl(body.invite?.inviteUrl ?? null);
      setLastClaimPassphrase(body.invite?.passphrase ?? null);
      setClaimFeedback({
        kind: "success",
        text: t("claimSentFor", { name: displayName }),
      });
      setClaimableCommanders((prev) =>
        prev.filter((c) => c.ashedMemberId !== claimCommanderSelected),
      );
      setClaimCommanderSelected("");
      setClaimAdminLabel("");
    } catch (error) {
      setClaimFeedback({
        kind: "error",
        text: error instanceof Error ? error.message : t("claimFailed"),
      });
    } finally {
      setBusy(false);
    }
  }

  function toggleBulkSelected(ashedMemberId: string) {
    setBulkSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(ashedMemberId)) {
        next.delete(ashedMemberId);
      } else {
        next.add(ashedMemberId);
      }
      return next;
    });
  }

  function toggleBulkSelectAll() {
    setBulkSelectedIds((prev) =>
      prev.size === claimableCommanders.length
        ? new Set()
        : new Set(claimableCommanders.map((c) => c.ashedMemberId)),
    );
  }

  async function sendBulkClaimInvites() {
    if (bulkSelectedIds.size === 0 || gameServerNumber == null) return;

    setBusy(true);
    setBulkClaimFeedback(null);
    setBulkClaimResults([]);

    const selectedSnapshot = claimableCommanders.filter((c) =>
      bulkSelectedIds.has(c.ashedMemberId),
    );

    try {
      const res = await fetch("/api/settings/team/invites/bulk-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetAshedMemberIds: Array.from(bulkSelectedIds),
          adminLabel: bulkClaimAdminLabel.trim() || undefined,
        }),
      });
      const body = (await res.json()) as {
        error?: string;
        created?: Array<{
          targetAshedMemberId?: string | null;
          targetCommanderName?: string | null;
          inviteUrl: string;
          passphrase?: string | null;
        }>;
        skipped?: Array<{ ashedMemberId: string; code: string }>;
      };

      if (!res.ok) {
        setBulkClaimFeedback({ kind: "error", text: body.error ?? t("claimFailed") });
        return;
      }

      const created = body.created ?? [];
      const skipped = body.skipped ?? [];

      const results = created.map((c) => {
        const ashedMemberId = c.targetAshedMemberId ?? "";
        return {
          ashedMemberId,
          name:
            c.targetCommanderName ??
            selectedSnapshot.find((s) => s.ashedMemberId === ashedMemberId)?.name ??
            "",
          inviteUrl: c.inviteUrl,
          passphrase: c.passphrase ?? null,
        };
      });

      setBulkClaimResults(results);
      setBulkClaimFeedback({
        kind: "success",
        text: t("bulkClaimSummary", {
          created: results.length,
          skipped: skipped.length,
        }),
      });

      const handledIds = new Set<string>([
        ...created.map((c) => c.targetAshedMemberId ?? ""),
        ...skipped.map((s) => s.ashedMemberId),
      ]);
      setClaimableCommanders((prev) =>
        prev.filter((c) => !handledIds.has(c.ashedMemberId)),
      );
      setBulkSelectedIds(new Set());
      setBulkClaimAdminLabel("");
    } catch (error) {
      setBulkClaimFeedback({
        kind: "error",
        text: error instanceof Error ? error.message : t("claimFailed"),
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
              href={allianceSettingsPath(allianceTag)}
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
        <form
          className="mt-3"
          onSubmit={(event) => {
            preventDefaultFormSubmit(event);
            void sendInvite();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
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
              enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
              placeholder="/members"
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 font-mono text-sm"
            />
            <span className="block text-xs text-[#6e7681]">
              {t("inviteRedirectHint")}
            </span>
          </label>
          </div>
          <button
            type="submit"
            disabled={busy || !canSendInvite}
            className="mt-3 rounded-lg border border-[#388bfd] bg-[#388bfd]/10 px-4 py-2 text-sm text-[#58a6ff] disabled:opacity-50"
          >
            {t("inviteButton")}
          </button>
        </form>
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
        <form
          className="mt-3"
          onSubmit={(event) => {
            preventDefaultFormSubmit(event);
            void createJoinCode();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
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
              enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
              placeholder={t("joinCodeLabelPlaceholder")}
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
            />
          </label>
          </div>
          <button
            type="submit"
            disabled={busy || gameServerNumber == null}
            className="mt-3 rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {t("joinCodeButton")}
          </button>
        </form>
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

      <div className="border-t border-[#30363d] pt-5">
        <h3 className="text-sm font-semibold">{t("claimTitle")}</h3>
        <p className="mt-1 text-sm text-[#8b949e]">{t("claimHint")}</p>
        {claimableCommanders.length === 0 ? (
          <p className="mt-3 text-sm text-[#6e7681]">{t("claimEmpty")}</p>
        ) : (
          <>
            <div
              className="mt-3 inline-flex rounded-lg border border-[#30363d] p-0.5 text-sm"
              role="group"
            >
              <button
                type="button"
                onClick={() => setBulkClaimMode(false)}
                aria-pressed={!bulkClaimMode}
                className={
                  bulkClaimMode
                    ? "rounded-md px-3 py-1 text-[#8b949e]"
                    : "rounded-md bg-[#388bfd]/15 px-3 py-1 text-[#58a6ff]"
                }
              >
                {t("claimModeSingle")}
              </button>
              <button
                type="button"
                onClick={() => setBulkClaimMode(true)}
                aria-pressed={bulkClaimMode}
                className={
                  bulkClaimMode
                    ? "rounded-md bg-[#388bfd]/15 px-3 py-1 text-[#58a6ff]"
                    : "rounded-md px-3 py-1 text-[#8b949e]"
                }
              >
                {t("claimModeBulk")}
              </button>
            </div>

            {bulkClaimMode ? (
              <form
                className="mt-3"
                onSubmit={(event) => {
                  preventDefaultFormSubmit(event);
                  void sendBulkClaimInvites();
                }}
              >
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[#8b949e]">
                    {t("bulkClaimSelectedCount", { count: bulkSelectedIds.size })}
                  </span>
                  <button
                    type="button"
                    onClick={toggleBulkSelectAll}
                    className="text-[#58a6ff] hover:underline"
                  >
                    {bulkSelectedIds.size === claimableCommanders.length
                      ? t("bulkClaimClearAll")
                      : t("bulkClaimSelectAll")}
                  </button>
                </div>
                <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-lg border border-[#30363d] p-2">
                  {claimableCommanders.map((commander) => (
                    <li key={commander.ashedMemberId}>
                      <label className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-[#161b22]">
                        <input
                          type="checkbox"
                          checked={bulkSelectedIds.has(commander.ashedMemberId)}
                          onChange={() => toggleBulkSelected(commander.ashedMemberId)}
                        />
                        <span className="min-w-0 break-all">{commander.name}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                <label className="mt-3 block space-y-1 text-sm">
                  <span className="text-[#8b949e]">{t("inviteAdminLabel")}</span>
                  <input
                    type="text"
                    value={bulkClaimAdminLabel}
                    onChange={(e) => setBulkClaimAdminLabel(e.target.value)}
                    placeholder={t("inviteAdminLabelPlaceholder")}
                    className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
                  />
                </label>
                <button
                  type="submit"
                  disabled={
                    busy || bulkSelectedIds.size === 0 || gameServerNumber == null
                  }
                  className="mt-3 w-full rounded-lg border border-[#388bfd] bg-[#388bfd]/10 px-4 py-2 text-sm text-[#58a6ff] disabled:opacity-50 sm:w-auto"
                >
                  {t("bulkClaimButton", { count: bulkSelectedIds.size })}
                </button>
                <ActionFeedbackBanner feedback={bulkClaimFeedback} />
                {bulkClaimResults.length > 0 ? (
                  <div className="mt-3 space-y-3">
                    <p className="text-sm font-semibold">{t("bulkClaimResultsTitle")}</p>
                    {bulkClaimResults.map((result) => (
                      <div
                        key={result.ashedMemberId}
                        className="rounded-lg border border-[#30363d] p-3"
                      >
                        <p className="text-sm font-medium">{result.name}</p>
                        <CopyToClipboardField
                          className="mt-2"
                          label={t("claimLinkLabel")}
                          value={result.inviteUrl}
                        />
                        {result.passphrase ? (
                          <CopyToClipboardField
                            className="mt-2"
                            label={t("invitePassphraseLabel")}
                            value={result.passphrase}
                          />
                        ) : null}
                      </div>
                    ))}
                    <p className="text-xs text-[#6e7681]">
                      {t("invitePassphraseHint")}
                    </p>
                  </div>
                ) : null}
              </form>
            ) : (
              <>
                <form
                  className="mt-3"
                  onSubmit={(event) => {
                    preventDefaultFormSubmit(event);
                    void sendClaimInvite();
                  }}
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1 text-sm">
                      <span className="text-[#8b949e]">{t("claimCommanderLabel")}</span>
                      <select
                        value={claimCommanderSelected}
                        onChange={(e) => setClaimCommanderSelected(e.target.value)}
                        className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
                      >
                        <option value="">{t("claimCommanderPlaceholder")}</option>
                        {claimableCommanders.map((commander) => (
                          <option
                            key={commander.ashedMemberId}
                            value={commander.ashedMemberId}
                          >
                            {commander.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1 text-sm">
                      <span className="text-[#8b949e]">{t("inviteAdminLabel")}</span>
                      <input
                        type="text"
                        value={claimAdminLabel}
                        onChange={(e) => setClaimAdminLabel(e.target.value)}
                        placeholder={t("inviteAdminLabelPlaceholder")}
                        className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
                      />
                    </label>
                  </div>
                  <button
                    type="submit"
                    disabled={
                      busy || !claimCommanderSelected || gameServerNumber == null
                    }
                    className="mt-3 rounded-lg border border-[#388bfd] bg-[#388bfd]/10 px-4 py-2 text-sm text-[#58a6ff] disabled:opacity-50"
                  >
                    {t("claimButton")}
                  </button>
                </form>
                <ActionFeedbackBanner feedback={claimFeedback} />
                {lastClaimUrl ? (
                  <CopyToClipboardField
                    className="mt-3"
                    label={t("claimLinkLabel")}
                    value={lastClaimUrl}
                  />
                ) : null}
                {lastClaimPassphrase ? (
                  <CopyToClipboardField
                    className="mt-3"
                    label={t("invitePassphraseLabel")}
                    value={lastClaimPassphrase}
                  />
                ) : null}
                {lastClaimPassphrase ? (
                  <p className="mt-1 text-xs text-[#6e7681]">
                    {t("invitePassphraseHint")}
                  </p>
                ) : null}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
