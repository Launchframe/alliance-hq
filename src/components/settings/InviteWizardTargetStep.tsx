"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";
import { MAX_BULK_CLAIM_INVITES } from "@/lib/native-alliance/claim-invites.shared";
import {
  JOIN_CODE_DEFAULT_MAX_USES,
  type InviteLinkSubtype,
  type InviteWizardTargets,
  type InviteWizardType,
} from "@/lib/settings/invite-wizard.shared";
import type { SystemRoleName } from "@/lib/rbac/constants";

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

type CommanderRow = { ashedMemberId: string; name: string };

type Props = {
  inviteType: InviteWizardType;
  targets: InviteWizardTargets;
  onChange: (patch: Partial<InviteWizardTargets>) => void;
  assignableRoles: SystemRoleName[];
  commanders: CommanderRow[];
  nearFullRoster: boolean;
};

function SharingReminder({ inviteType }: { inviteType: InviteWizardType }) {
  const t = useTranslations("team.invites.wizard");
  const isPublic = inviteType === "join_code";
  return (
    <div
      className={
        isPublic
          ? "rounded-lg border border-[#238636]/30 bg-[#238636]/5 px-3 py-2 text-sm text-[#c9d1d9]"
          : "rounded-lg border border-[#e3b341]/30 bg-[#e3b341]/5 px-3 py-2 text-sm text-[#c9d1d9]"
      }
      role="note"
    >
      <span
        className={
          isPublic
            ? "mr-2 rounded-full border border-[#238636]/40 bg-[#238636]/10 px-2 py-0.5 text-xs font-medium text-[#3fb950]"
            : "mr-2 rounded-full border border-[#e3b341]/40 bg-[#e3b341]/10 px-2 py-0.5 text-xs font-medium text-[#e3b341]"
        }
      >
        {isPublic ? t("badgePublicOk") : t("badgeDmOnly")}
      </span>
      {isPublic ? t("sharingReminderPublic") : t("sharingReminderDm")}
    </div>
  );
}

export function InviteWizardTargetStep({
  inviteType,
  targets,
  onChange,
  assignableRoles,
  commanders,
  nearFullRoster,
}: Props) {
  const t = useTranslations("team.invites");
  const tWizard = useTranslations("team.invites.wizard");

  const roleOptions = useMemo(
    () =>
      assignableRoles.map((role) => ({
        value: role,
        label: t(ROLE_LABEL_KEYS[role]),
      })),
    [assignableRoles, t],
  );

  const bulkSelectableCap = Math.min(commanders.length, MAX_BULK_CLAIM_INVITES);
  const bulkAllSelected =
    bulkSelectableCap > 0 &&
    commanders
      .slice(0, bulkSelectableCap)
      .every((c) => targets.bulkSelectedIds.includes(c.ashedMemberId));

  function setJoinCodeRole(role: SystemRoleName) {
    onChange({
      joinCodeRole: role,
      joinCodeMaxUses: String(JOIN_CODE_DEFAULT_MAX_USES[role] ?? 10),
    });
  }

  function toggleBulkId(ashedMemberId: string) {
    const current = new Set(targets.bulkSelectedIds);
    if (current.has(ashedMemberId)) {
      current.delete(ashedMemberId);
    } else if (current.size < MAX_BULK_CLAIM_INVITES) {
      current.add(ashedMemberId);
    }
    onChange({ bulkSelectedIds: Array.from(current) });
  }

  function toggleBulkSelectAll() {
    if (bulkAllSelected) {
      onChange({ bulkSelectedIds: [] });
      return;
    }
    onChange({
      bulkSelectedIds: commanders
        .slice(0, bulkSelectableCap)
        .map((c) => c.ashedMemberId),
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">{tWizard("targetStepTitle")}</h3>
        <p className="mt-1 text-sm text-[#8b949e]">{tWizard("targetStepHint")}</p>
      </div>

      <SharingReminder inviteType={inviteType} />

      {inviteType === "invite_link" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="text-[#8b949e]">{t("inviteKind")}</span>
            <select
              value={targets.inviteLinkSubtype}
              onChange={(e) =>
                onChange({
                  inviteLinkSubtype: e.target.value as InviteLinkSubtype,
                })
              }
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
            >
              <option value="protected_link">{t("inviteKindProtected")}</option>
              <option value="email">{t("inviteKindEmail")}</option>
            </select>
          </label>
          {targets.inviteLinkSubtype === "email" ? (
            <label className="space-y-1 text-sm sm:col-span-2">
              <span className="text-[#8b949e]">{t("inviteEmail")}</span>
              <input
                type="email"
                value={targets.inviteEmail}
                onChange={(e) => onChange({ inviteEmail: e.target.value })}
                className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
                autoComplete="email"
              />
              <span className="block text-xs text-[#6e7681]">
                {t("inviteEmailHint")}
              </span>
            </label>
          ) : (
            <label className="space-y-1 text-sm sm:col-span-2">
              <span className="text-[#8b949e]">{t("inviteAdminLabel")}</span>
              <input
                type="text"
                value={targets.inviteAdminLabel}
                onChange={(e) => onChange({ inviteAdminLabel: e.target.value })}
                placeholder={t("inviteAdminLabelPlaceholder")}
                className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
              />
            </label>
          )}
          <label className="space-y-1 text-sm">
            <span className="text-[#8b949e]">{t("inviteRole")}</span>
            <select
              value={targets.inviteRole}
              onChange={(e) =>
                onChange({
                  inviteRole: e.target.value as SystemRoleName | "",
                })
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
          {nearFullRoster && targets.inviteRole === "member" ? (
            <p className="sm:col-span-2 text-xs text-[#e3b341]" role="status">
              {t("memberRoleNearFullWarning")}
            </p>
          ) : null}
          <details className="sm:col-span-2">
            <summary className="cursor-pointer text-sm text-[#8b949e] marker:content-none [&::-webkit-details-marker]:hidden">
              {tWizard("advancedOptions")}
            </summary>
            <label className="mt-3 block space-y-1 text-sm">
              <span className="text-[#8b949e]">{t("inviteRedirectOptional")}</span>
              <input
                type="text"
                value={targets.inviteRedirectPath}
                onChange={(e) =>
                  onChange({ inviteRedirectPath: e.target.value })
                }
                enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
                placeholder="/members"
                className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 font-mono text-sm"
              />
              <span className="block text-xs text-[#6e7681]">
                {t("inviteRedirectHint")}
              </span>
            </label>
          </details>
        </div>
      ) : null}

      {inviteType === "join_code" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-[#8b949e]">{t("joinCodeRole")}</span>
            <select
              value={targets.joinCodeRole}
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
              value={targets.joinCodeMaxUses}
              onChange={(e) => onChange({ joinCodeMaxUses: e.target.value })}
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
            />
            <span className="block text-xs text-[#6e7681]">
              {tWizard("joinCodeMaxUsesHint")}
            </span>
          </label>
          {nearFullRoster && targets.joinCodeRole === "member" ? (
            <p className="sm:col-span-2 text-xs text-[#e3b341]" role="status">
              {t("memberRoleNearFullWarning")}
            </p>
          ) : null}
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="text-[#8b949e]">{t("joinCodeLabelField")}</span>
            <input
              type="text"
              value={targets.joinCodeLabel}
              onChange={(e) => onChange({ joinCodeLabel: e.target.value })}
              placeholder={t("joinCodeLabelPlaceholder")}
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
            />
          </label>
        </div>
      ) : null}

      {inviteType === "commander_claim" ? (
        commanders.length === 0 ? (
          <p className="text-sm text-[#6e7681]">{t("claimEmpty")}</p>
        ) : (
          <>
            <div
              className="inline-flex rounded-lg border border-[#30363d] p-0.5 text-sm"
              role="group"
            >
              <button
                type="button"
                onClick={() => onChange({ claimMode: "single" })}
                aria-pressed={targets.claimMode === "single"}
                className={
                  targets.claimMode === "single"
                    ? "rounded-md bg-[#388bfd]/15 px-3 py-1 text-[#58a6ff]"
                    : "rounded-md px-3 py-1 text-[#8b949e]"
                }
              >
                {t("claimModeSingle")}
              </button>
              <button
                type="button"
                onClick={() => onChange({ claimMode: "bulk" })}
                aria-pressed={targets.claimMode === "bulk"}
                className={
                  targets.claimMode === "bulk"
                    ? "rounded-md bg-[#388bfd]/15 px-3 py-1 text-[#58a6ff]"
                    : "rounded-md px-3 py-1 text-[#8b949e]"
                }
              >
                {t("claimModeBulk")}
              </button>
            </div>

            {targets.claimMode === "bulk" ? (
              <form
                onSubmit={(event) => preventDefaultFormSubmit(event)}
                className="space-y-3"
              >
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[#8b949e]">
                    {t("bulkClaimSelectedCount", {
                      count: targets.bulkSelectedIds.length,
                    })}
                  </span>
                  <button
                    type="button"
                    onClick={toggleBulkSelectAll}
                    className="text-[#58a6ff] hover:underline"
                  >
                    {bulkAllSelected
                      ? t("bulkClaimClearAll")
                      : t("bulkClaimSelectAll")}
                  </button>
                </div>
                <ul className="max-h-64 min-w-0 space-y-1 overflow-y-auto rounded-lg border border-[#30363d] p-2">
                  {commanders.map((commander) => (
                    <li key={commander.ashedMemberId}>
                      <label className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-[#161b22]">
                        <input
                          type="checkbox"
                          checked={targets.bulkSelectedIds.includes(
                            commander.ashedMemberId,
                          )}
                          disabled={
                            !targets.bulkSelectedIds.includes(
                              commander.ashedMemberId,
                            ) &&
                            targets.bulkSelectedIds.length >=
                              MAX_BULK_CLAIM_INVITES
                          }
                          onChange={() =>
                            toggleBulkId(commander.ashedMemberId)
                          }
                        />
                        <span className="min-w-0 break-all">
                          {commander.name}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </form>
            ) : (
              <label className="block space-y-1 text-sm">
                <span className="text-[#8b949e]">{t("claimCommanderLabel")}</span>
                <select
                  value={targets.claimCommanderId}
                  onChange={(e) =>
                    onChange({ claimCommanderId: e.target.value })
                  }
                  className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
                >
                  <option value="">{t("claimCommanderPlaceholder")}</option>
                  {commanders.map((commander) => (
                    <option
                      key={commander.ashedMemberId}
                      value={commander.ashedMemberId}
                    >
                      {commander.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="block space-y-1 text-sm">
              <span className="text-[#8b949e]">{t("inviteAdminLabel")}</span>
              <input
                type="text"
                value={targets.claimAdminLabel}
                onChange={(e) => onChange({ claimAdminLabel: e.target.value })}
                placeholder={t("inviteAdminLabelPlaceholder")}
                className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
              />
            </label>
          </>
        )
      ) : null}
    </div>
  );
}
