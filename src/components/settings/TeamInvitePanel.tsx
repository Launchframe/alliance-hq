"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { CopyToClipboardField } from "@/components/ui/CopyToClipboardField";
import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";
import { MAX_BULK_CLAIM_INVITES } from "@/lib/native-alliance/claim-invites.shared";
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
          ? "mt-3 text-sm text-hq-danger"
          : "mt-3 text-sm text-hq-green"
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
};

export function TeamInvitePanel({ assignableRoles }: Props) {
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
  const [lastClaimCode, setLastClaimCode] = useState<string | null>(null);

  const [bulkClaimMode, setBulkClaimMode] = useState(false);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
  const [bulkClaimAdminLabel, setBulkClaimAdminLabel] = useState("");
  const [bulkClaimFeedback, setBulkClaimFeedback] = useState<ActionFeedback>(null);
  const [bulkClaimResults, setBulkClaimResults] = useState<
    Array<{ ashedMemberId: string; name: string; code: string }>
  >([]);
  const [nearFullRoster, setNearFullRoster] = useState(false);
  const [activeRosterCount, setActiveRosterCount] = useState(0);
  const [rosterMaxMembers, setRosterMaxMembers] = useState(100);

  const bulkSelectableCap = useMemo(
    () => Math.min(claimableCommanders.length, MAX_BULK_CLAIM_INVITES),
    [claimableCommanders.length],
  );

  const bulkAllSelected = useMemo(
    () =>
      bulkSelectableCap > 0 &&
      claimableCommanders
        .slice(0, bulkSelectableCap)
        .every((commander) => bulkSelectedIds.has(commander.ashedMemberId)),
    [bulkSelectableCap, bulkSelectedIds, claimableCommanders],
  );

  const loadClaimableCommanders = useCallback(async (options?: {
    applyNearFullDefaults?: boolean;
  }) => {
    try {
      const res = await fetch("/api/settings/team/claimable-commanders");
      if (!res.ok) return;

      const data = (await res.json()) as {
        commanders?: Array<{ ashedMemberId: string; name: string }>;
        roster?: {
          activeCount?: number;
          maxMembers?: number;
          nearFull?: boolean;
        };
      };

      const commanders = data.commanders ?? [];
      setClaimableCommanders(commanders);
      setClaimCommanderSelected((prev) =>
        prev && commanders.some((commander) => commander.ashedMemberId === prev)
          ? prev
          : "",
      );
      setBulkSelectedIds((prev) => {
        const allowed = new Set(
          commanders.slice(0, MAX_BULK_CLAIM_INVITES).map((c) => c.ashedMemberId),
        );
        const next = new Set<string>();
        for (const id of prev) {
          if (allowed.has(id)) {
            next.add(id);
          }
        }
        return next;
      });

      const nearFull = Boolean(data.roster?.nearFull);
      const activeCount = data.roster?.activeCount ?? 0;
      const maxMembers = data.roster?.maxMembers ?? 100;
      setNearFullRoster(nearFull);
      setActiveRosterCount(activeCount);
      setRosterMaxMembers(maxMembers);

      if (options?.applyNearFullDefaults && nearFull) {
        if (commanders.length > 1) {
          setBulkClaimMode(true);
        }
        const preferredNonMemberRole = assignableRoles.find(
          (role) => role !== "member",
        );
        if (preferredNonMemberRole) {
          setInviteRole(preferredNonMemberRole);
          setJoinCodeRole(preferredNonMemberRole);
        }
      }
    } catch {
      // ignore
    }
  }, [assignableRoles]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void loadClaimableCommanders({ applyNearFullDefaults: true });
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [loadClaimableCommanders]);

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
    if (!claimCommanderSelected) return;

    setBusy(true);
    setClaimFeedback(null);
    setLastClaimCode(null);

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
        joinCode?: {
          code: string;
          targetCommanderName?: string | null;
        };
      };
      if (!res.ok) {
        if (body.code === "commander_already_claimed") {
          setClaimFeedback({ kind: "error", text: t("claimAlreadyClaimed") });
          void loadClaimableCommanders();
          setClaimCommanderSelected("");
        } else {
          setClaimFeedback({
            kind: "error",
            text: body.error ?? t("claimFailed"),
          });
        }
        return;
      }
      const displayName =
        body.joinCode?.targetCommanderName ?? selectedCommander?.name ?? "";
      setLastClaimCode(body.joinCode?.code ?? null);
      setClaimFeedback({
        kind: "success",
        text: t("claimSentFor", { name: displayName }),
      });
      void loadClaimableCommanders();
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
      } else if (next.size < MAX_BULK_CLAIM_INVITES) {
        next.add(ashedMemberId);
      }
      return next;
    });
  }

  function toggleBulkSelectAll() {
    setBulkSelectedIds((prev) => {
      const cap = Math.min(claimableCommanders.length, MAX_BULK_CLAIM_INVITES);
      const allIds = claimableCommanders.slice(0, cap).map((c) => c.ashedMemberId);
      const allSelected =
        allIds.length > 0 && allIds.every((id) => prev.has(id));
      return allSelected ? new Set() : new Set(allIds);
    });
  }

  async function sendBulkClaimInvites() {
    if (bulkSelectedIds.size === 0) return;

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
          code: string;
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
          code: c.code,
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

      void loadClaimableCommanders();
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

  function renderClaimSection(highlighted: boolean) {
    return (
      <div
        id="commander-claim-invites"
        className={
          highlighted
            ? "rounded-lg border border-[#388bfd]/30 bg-hq-canvas/50 p-4"
            : "border-t border-hq-border pt-5"
        }
      >
        <h3 className="text-sm font-semibold">{t("claimTitle")}</h3>
        <p className="mt-1 text-sm text-hq-fg-muted">{t("claimHint")}</p>
        {claimableCommanders.length === 0 ? (
          <p className="mt-3 text-sm text-hq-fg-subtle">{t("claimEmpty")}</p>
        ) : (
          <>
            <div
              className="mt-3 inline-flex rounded-lg border border-hq-border p-0.5 text-sm"
              role="group"
            >
              <button
                type="button"
                onClick={() => {
                  setBulkClaimMode(false);
                  void loadClaimableCommanders();
                }}
                aria-pressed={!bulkClaimMode}
                className={
                  bulkClaimMode
                    ? "rounded-md px-3 py-1 text-hq-fg-muted"
                    : "rounded-md bg-[#388bfd]/15 px-3 py-1 text-hq-accent"
                }
              >
                {t("claimModeSingle")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setBulkClaimMode(true);
                  void loadClaimableCommanders();
                }}
                aria-pressed={bulkClaimMode}
                className={
                  bulkClaimMode
                    ? "rounded-md bg-[#388bfd]/15 px-3 py-1 text-hq-accent"
                    : "rounded-md px-3 py-1 text-hq-fg-muted"
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
                  <span className="text-hq-fg-muted">
                    {t("bulkClaimSelectedCount", { count: bulkSelectedIds.size })}
                  </span>
                  <button
                    type="button"
                    onClick={toggleBulkSelectAll}
                    className="text-hq-accent hover:underline"
                  >
                    {bulkAllSelected ? t("bulkClaimClearAll") : t("bulkClaimSelectAll")}
                  </button>
                </div>
                <ul className="mt-2 max-h-64 min-w-0 space-y-1 overflow-y-auto rounded-lg border border-hq-border p-2">
                  {claimableCommanders.map((commander) => (
                    <li key={commander.ashedMemberId}>
                      <label className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-hq-surface">
                        <input
                          type="checkbox"
                          checked={bulkSelectedIds.has(commander.ashedMemberId)}
                          disabled={
                            !bulkSelectedIds.has(commander.ashedMemberId) &&
                            bulkSelectedIds.size >= MAX_BULK_CLAIM_INVITES
                          }
                          onChange={() => toggleBulkSelected(commander.ashedMemberId)}
                        />
                        <span className="min-w-0 break-all">{commander.name}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                <label className="mt-3 block space-y-1 text-sm">
                  <span className="text-hq-fg-muted">{t("inviteAdminLabel")}</span>
                  <input
                    type="text"
                    value={bulkClaimAdminLabel}
                    onChange={(e) => setBulkClaimAdminLabel(e.target.value)}
                    placeholder={t("inviteAdminLabelPlaceholder")}
                    className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2"
                  />
                </label>
                <button
                  type="submit"
                  disabled={
                    busy || bulkSelectedIds.size === 0
                  }
                  className="mt-3 w-full rounded-lg border border-[#388bfd] bg-[#388bfd]/10 px-4 py-2 text-sm text-hq-accent disabled:opacity-50 sm:w-auto"
                >
                  {t("bulkClaimButton", { count: bulkSelectedIds.size })}
                </button>
                <ActionFeedbackBanner feedback={bulkClaimFeedback} />
                {bulkClaimResults.length > 0 ? (
                  <div className="mt-3 min-w-0 space-y-3">
                    <p className="text-sm font-semibold">{t("bulkClaimResultsTitle")}</p>
                    {bulkClaimResults.map((result) => (
                      <div
                        key={result.ashedMemberId}
                        className="rounded-lg border border-hq-border p-3"
                      >
                        <p className="text-sm font-medium">{result.name}</p>
                        <CopyToClipboardField
                          className="mt-2"
                          label={t("claimCodeLabel")}
                          value={result.code}
                        />
                      </div>
                    ))}
                    <p className="text-xs text-hq-fg-subtle">{t("claimCodeHint")}</p>
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
                      <span className="text-hq-fg-muted">{t("claimCommanderLabel")}</span>
                      <select
                        value={claimCommanderSelected}
                        onChange={(e) => setClaimCommanderSelected(e.target.value)}
                        className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2"
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
                      <span className="text-hq-fg-muted">{t("inviteAdminLabel")}</span>
                      <input
                        type="text"
                        value={claimAdminLabel}
                        onChange={(e) => setClaimAdminLabel(e.target.value)}
                        placeholder={t("inviteAdminLabelPlaceholder")}
                        className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2"
                      />
                    </label>
                  </div>
                  <button
                    type="submit"
                    disabled={
                      busy || !claimCommanderSelected
                    }
                    className="mt-3 rounded-lg border border-[#388bfd] bg-[#388bfd]/10 px-4 py-2 text-sm text-hq-accent disabled:opacity-50"
                  >
                    {t("claimButton")}
                  </button>
                </form>
                <ActionFeedbackBanner feedback={claimFeedback} />
                {lastClaimCode ? (
                  <CopyToClipboardField
                    className="mt-3"
                    label={t("claimCodeLabel")}
                    value={lastClaimCode}
                  />
                ) : null}
                {lastClaimCode ? (
                  <p className="mt-1 text-xs text-hq-fg-subtle">{t("claimCodeHint")}</p>
                ) : null}
              </>
            )}
          </>
        )}
      </div>
    );
  }

  function renderGenericInviteSections() {
    return (
      <>
        <div className="border-t border-hq-border pt-5">
          <h3 className="text-sm font-semibold">{t("inviteTitle")}</h3>
          <p className="mt-1 text-sm text-hq-fg-muted">{t("inviteHint")}</p>
          <form
            className="mt-3"
            onSubmit={(event) => {
              preventDefaultFormSubmit(event);
              void sendInvite();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm sm:col-span-2">
                <span className="text-hq-fg-muted">{t("inviteKind")}</span>
                <select
                  value={inviteKind}
                  onChange={(e) => setInviteKind(e.target.value as InviteKind)}
                  className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2"
                >
                  <option value="protected_link">{t("inviteKindProtected")}</option>
                  <option value="email">{t("inviteKindEmail")}</option>
                </select>
              </label>
              {inviteKind === "email" ? (
                <label className="space-y-1 text-sm">
                  <span className="text-hq-fg-muted">{t("inviteEmail")}</span>
                  <input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2"
                    autoComplete="email"
                  />
                  <span className="block text-xs text-hq-fg-subtle">
                    {t("inviteEmailHint")}
                  </span>
                </label>
              ) : (
                <label className="space-y-1 text-sm">
                  <span className="text-hq-fg-muted">{t("inviteAdminLabel")}</span>
                  <input
                    type="text"
                    value={inviteAdminLabel}
                    onChange={(e) => setInviteAdminLabel(e.target.value)}
                    placeholder={t("inviteAdminLabelPlaceholder")}
                    className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2"
                  />
                </label>
              )}
              <label className="space-y-1 text-sm">
                <span className="text-hq-fg-muted">{t("inviteRole")}</span>
                <select
                  value={inviteRole}
                  onChange={(e) =>
                    setInviteRole(e.target.value as SystemRoleName | "")
                  }
                  className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2"
                >
                  <option value="">{t("inviteRolePlaceholder")}</option>
                  {roleOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {nearFullRoster && inviteRole === "member" ? (
                <p
                  className="sm:col-span-2 text-xs text-[#e3b341]"
                  role="status"
                >
                  {t("memberRoleNearFullWarning")}
                </p>
              ) : null}
              <label className="space-y-1 text-sm sm:col-span-2">
                <span className="text-hq-fg-muted">{t("inviteRedirectOptional")}</span>
                <input
                  type="text"
                  value={inviteRedirectPath}
                  onChange={(e) => setInviteRedirectPath(e.target.value)}
                  enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
                  placeholder="/members"
                  className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 font-mono text-sm"
                />
                <span className="block text-xs text-hq-fg-subtle">
                  {t("inviteRedirectHint")}
                </span>
              </label>
            </div>
            <button
              type="submit"
              disabled={busy || !canSendInvite}
              className="mt-3 rounded-lg border border-[#388bfd] bg-[#388bfd]/10 px-4 py-2 text-sm text-hq-accent disabled:opacity-50"
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
            <p className="mt-1 text-xs text-hq-fg-subtle">{t("invitePassphraseHint")}</p>
          ) : null}
        </div>

        <div className="border-t border-hq-border pt-5">
          <h3 className="text-sm font-semibold">{t("joinCodeTitle")}</h3>
          <p className="mt-1 text-sm text-hq-fg-muted">{t("joinCodeHint")}</p>
          <form
            className="mt-3"
            onSubmit={(event) => {
              preventDefaultFormSubmit(event);
              void createJoinCode();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="text-hq-fg-muted">{t("joinCodeRole")}</span>
                <select
                  value={joinCodeRole}
                  onChange={(e) =>
                    setJoinCodeRole(e.target.value as SystemRoleName)
                  }
                  className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2"
                >
                  {roleOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {nearFullRoster && joinCodeRole === "member" ? (
                <p className="sm:col-span-2 text-xs text-[#e3b341]" role="status">
                  {t("memberRoleNearFullWarning")}
                </p>
              ) : null}
              <label className="space-y-1 text-sm">
                <span className="text-hq-fg-muted">{t("joinCodeMaxUses")}</span>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={joinCodeMaxUses}
                  onChange={(e) => setJoinCodeMaxUses(e.target.value)}
                  className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2"
                />
              </label>
              <label className="space-y-1 text-sm sm:col-span-2">
                <span className="text-hq-fg-muted">{t("joinCodeLabelField")}</span>
                <input
                  type="text"
                  value={joinCodeLabel}
                  onChange={(e) => setJoinCodeLabel(e.target.value)}
                  enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
                  placeholder={t("joinCodeLabelPlaceholder")}
                  className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2"
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={busy}
              className="mt-3 rounded-lg border border-hq-success bg-hq-success px-4 py-2 text-sm text-white disabled:opacity-50"
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
              <p className="mt-1 text-xs text-hq-fg-subtle">{t("joinCodeValueHint")}</p>
            </>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <div className="space-y-8 rounded-xl border border-hq-border bg-hq-surface p-5">
      <div>
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="mt-1 text-sm text-hq-fg-muted">{t("description")}</p>
      </div>

      {nearFullRoster ? (
        <div
          className="rounded-lg border border-[#388bfd]/40 bg-[#388bfd]/10 p-4 text-sm text-[#c9d1d9]"
          role="status"
        >
          {t("nearFullRosterBanner", {
            count: activeRosterCount,
            max: rosterMaxMembers,
          })}
        </div>
      ) : null}

      {nearFullRoster ? renderClaimSection(true) : null}

      {nearFullRoster ? (
        <details className="border-t border-hq-border pt-5">
          <summary className="cursor-pointer text-sm font-semibold text-hq-fg-muted marker:content-none [&::-webkit-details-marker]:hidden">
            {t("nearFullAdvancedTitle")}
            <span className="mt-1 block text-xs font-normal text-hq-fg-subtle">
              {t("nearFullAdvancedHint")}
            </span>
          </summary>
          <div className="mt-5 space-y-8">{renderGenericInviteSections()}</div>
        </details>
      ) : (
        <>
          {renderGenericInviteSections()}
          {renderClaimSection(false)}
        </>
      )}
    </div>
  );
}
