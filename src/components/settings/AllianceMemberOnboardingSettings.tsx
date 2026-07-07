"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { commanderClaimInvitesLink } from "@/components/i18n/richText";
import { allianceMemberOnboardingApiPath } from "@/lib/alliance/alliance-settings-path.shared";
import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";
import { ROSTER_MAX_MEMBERS } from "@/lib/members/roster-rank-quota.shared";

export type MemberOnboardingSettingsPayload = {
  selfServiceOnboardingEnabled: boolean;
  inviteOnboardingMinRole: "officer" | "owner";
  activeMemberCount: number;
  canCreateRosterMembersDuringOnboarding: boolean;
  canManage: boolean;
  canManageInvitesAndOnboarding: boolean;
  canReviewMemberLinks: boolean;
};

type Props = {
  allianceTag: string;
};

export function AllianceMemberOnboardingSettings({ allianceTag }: Props) {
  const t = useTranslations("settings.memberOnboarding");
  const [settings, setSettings] = useState<MemberOnboardingSettingsPayload | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [loadedTag, setLoadedTag] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const loading = loadedTag !== allianceTag;
  const display = loadedTag === allianceTag ? settings : null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(allianceMemberOnboardingApiPath(allianceTag));
        const body = (await res.json()) as MemberOnboardingSettingsPayload & {
          error?: string;
        };
        if (!res.ok) {
          if (!cancelled) {
            setError(body.error ?? t("loadFailed"));
            setLoadedTag(allianceTag);
          }
          return;
        }
        if (!cancelled) {
          setSettings(body);
          setError(null);
          setLoadedTag(allianceTag);
        }
      } catch {
        if (!cancelled) {
          setError(t("loadFailed"));
          setLoadedTag(allianceTag);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allianceTag, t]);

  const patchSettings = async (
    patch: Partial<
      Pick<
        MemberOnboardingSettingsPayload,
        "selfServiceOnboardingEnabled" | "inviteOnboardingMinRole"
      >
    >,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(allianceMemberOnboardingApiPath(allianceTag), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = (await res.json()) as MemberOnboardingSettingsPayload & {
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? t("saveFailed"));
        return;
      }
      setSettings(body);
      setConfirmDisable(false);
    } catch {
      setError(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const toggleSelfService = async (enabled: boolean) => {
    if (!enabled && display?.selfServiceOnboardingEnabled) {
      setConfirmDisable(true);
      return;
    }
    await patchSettings({ selfServiceOnboardingEnabled: enabled });
  };

  if (loading) {
    return <p className="text-sm text-[#8b949e]">{t("loading")}</p>;
  }

  if (!display) {
    return error ? (
      <p className="text-sm text-red-400" role="alert">
        {error}
      </p>
    ) : null;
  }

  const rosterFull =
    display.selfServiceOnboardingEnabled &&
    !display.canCreateRosterMembersDuringOnboarding;

  return (
    <form
      className="space-y-6"
      onSubmit={preventDefaultFormSubmit}
      aria-describedby={FORM_SUBMIT_ENTER_KEY_HINT}
    >
      {error ? (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      {!display.canManage ? (
        <p className="text-sm text-[#8b949e]">{t("readOnlyHint")}</p>
      ) : null}

      {!display.canManageInvitesAndOnboarding &&
      display.inviteOnboardingMinRole === "owner" ? (
        <p className="text-sm text-[#8b949e]">{t("officerReadOnlyActionsHint")}</p>
      ) : null}

      <section className="space-y-3">
        <h2 className="font-medium">{t("selfServiceTitle")}</h2>
        <p className="text-sm text-[#8b949e]">{t("selfServiceDescription")}</p>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={display.selfServiceOnboardingEnabled}
            disabled={!display.canManage || busy}
            onChange={(event) => void toggleSelfService(event.target.checked)}
          />
          <span>{t("selfServiceEnabledLabel")}</span>
        </label>
        {display.selfServiceOnboardingEnabled ? (
          <p className="text-sm text-[#3fb950]">{t("selfServiceActiveNotice")}</p>
        ) : (
          <p className="text-sm text-[#8b949e]">{t("selfServiceStrictNotice")}</p>
        )}
        {rosterFull ? (
          <div className="rounded-lg border border-[#9e6a03] bg-[#9e6a031a] p-3 text-sm space-y-2">
            <p>{t("rosterFullNotice", { count: ROSTER_MAX_MEMBERS })}</p>
            <ol className="list-decimal list-inside space-y-1 text-[#e3b341]">
              <li>{t("rosterFullHint1")}</li>
              <li>
                {display.canManageInvitesAndOnboarding
                  ? t.rich("rosterFullHint2", {
                      claimInvitesLink: commanderClaimInvitesLink,
                    })
                  : t("rosterFullHint2Plain")}
              </li>
            </ol>
          </div>
        ) : null}
      </section>

      {confirmDisable ? (
        <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-4 space-y-3">
          <p className="text-sm">{t("selfServiceDisableConfirmBody")}</p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void patchSettings({ selfServiceOnboardingEnabled: false })
              }
              className="rounded-lg bg-[#da3633] px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {t("selfServiceDisableConfirmAction")}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDisable(false)}
              className="rounded-lg border border-[#30363d] px-4 py-2 text-sm"
            >
              {t("selfServiceDisableCancel")}
            </button>
          </div>
        </div>
      ) : null}

      <section className="space-y-3 border-t border-[#30363d] pt-5">
        <h2 className="font-medium">{t("authorityTitle")}</h2>
        <p className="text-sm text-[#8b949e]">{t("authorityDescription")}</p>
        <fieldset className="space-y-3" disabled={!display.canManage || busy}>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="radio"
              name="inviteOnboardingMinRole"
              checked={display.inviteOnboardingMinRole === "officer"}
              onChange={() =>
                void patchSettings({ inviteOnboardingMinRole: "officer" })
              }
            />
            <span>
              <span className="font-medium">{t("authorityOfficerLabel")}</span>
              <span className="mt-1 block text-[#8b949e]">{t("authorityOfficerHint")}</span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="radio"
              name="inviteOnboardingMinRole"
              checked={display.inviteOnboardingMinRole === "owner"}
              onChange={() =>
                void patchSettings({ inviteOnboardingMinRole: "owner" })
              }
            />
            <span>
              <span className="font-medium">{t("authorityOwnerLabel")}</span>
              <span className="mt-1 block text-[#8b949e]">{t("authorityOwnerHint")}</span>
            </span>
          </label>
        </fieldset>
        {display.inviteOnboardingMinRole === "owner" ? (
          <p className="text-sm text-[#8b949e]">{t("authorityOwnerActiveNotice")}</p>
        ) : null}
      </section>
    </form>
  );
}
