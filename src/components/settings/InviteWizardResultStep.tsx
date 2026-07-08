"use client";

import { useTranslations } from "next-intl";

import { CopyShareMessageField } from "@/components/ui/CopyShareMessageField";
import { CopyToClipboardField } from "@/components/ui/CopyToClipboardField";
import type {
  InviteWizardResult,
  InviteWizardType,
} from "@/lib/settings/invite-wizard.shared";

type Props = {
  inviteType: InviteWizardType;
  result: InviteWizardResult | null;
  busy: boolean;
  error: string | null;
  onGenerate: () => void;
};

export function InviteWizardResultStep({
  inviteType,
  result,
  busy,
  error,
  onGenerate,
}: Props) {
  const t = useTranslations("team.invites");
  const tWizard = useTranslations("team.invites.wizard");

  const isPublic = inviteType === "join_code";

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">{tWizard("resultStepTitle")}</h3>
        <p className="mt-1 text-sm text-[#8b949e]">{tWizard("resultStepHint")}</p>
      </div>

      {!result ? (
        <button
          type="button"
          disabled={busy}
          onClick={onGenerate}
          className="rounded-lg border border-[#388bfd] bg-[#388bfd]/10 px-4 py-2 text-sm text-[#58a6ff] disabled:opacity-50"
        >
          {busy ? tWizard("generating") : tWizard("generateButton")}
        </button>
      ) : null}

      {error ? (
        <p className="text-sm text-[#f85149]" role="alert">
          {error}
        </p>
      ) : null}

      {result?.kind === "invite_link" ? (
        <div className="space-y-3">
          <CopyShareMessageField
            label={tWizard("shareMessageLabel")}
            message={result.shareMessage}
          />
          <CopyToClipboardField
            label={t("inviteLinkLabel")}
            value={result.inviteUrl}
          />
          {result.passphrase ? (
            <>
              <CopyToClipboardField
                label={t("invitePassphraseLabel")}
                value={result.passphrase}
              />
              <p className="text-xs text-[#6e7681]">{t("invitePassphraseHint")}</p>
            </>
          ) : null}
          <p className="text-xs text-[#6e7681]">{tWizard("sharingReminderDm")}</p>
        </div>
      ) : null}

      {result?.kind === "join_code" ? (
        <div className="space-y-3">
          <CopyShareMessageField
            label={tWizard("shareMessageLabel")}
            message={result.shareMessage}
          />
          <CopyToClipboardField
            label={t("joinCodeValueLabel")}
            value={result.code}
          />
          <p className="text-xs text-[#6e7681]">{tWizard("sharingReminderPublic")}</p>
        </div>
      ) : null}

      {result?.kind === "claim_single" ? (
        <div className="space-y-3">
          <p className="text-sm text-[#3fb950]">
            {t("claimSentFor", { name: result.commanderName })}
          </p>
          <CopyShareMessageField
            label={tWizard("shareMessageLabel")}
            message={result.shareMessage}
          />
          <CopyToClipboardField
            label={t("claimCodeLabel")}
            value={result.code}
          />
          <p className="text-xs text-[#6e7681]">{tWizard("sharingReminderDm")}</p>
        </div>
      ) : null}

      {result?.kind === "claim_bulk" ? (
        <div className="space-y-3">
          <p className="text-sm text-[#3fb950]">
            {t("bulkClaimSummary", {
              created: result.items.length,
              skipped: result.skippedCount,
            })}
          </p>
          {result.items.map((item) => (
            <div
              key={item.ashedMemberId}
              className="rounded-lg border border-[#30363d] p-3"
            >
              <p className="text-sm font-medium">{item.name}</p>
              <CopyShareMessageField
                className="mt-2"
                label={tWizard("shareMessageLabel")}
                message={item.shareMessage}
              />
              <CopyToClipboardField
                className="mt-2"
                label={t("claimCodeLabel")}
                value={item.code}
              />
            </div>
          ))}
          <p className="text-xs text-[#6e7681]">{tWizard("sharingReminderDm")}</p>
        </div>
      ) : null}

      {result ? (
        <p
          className={
            isPublic
              ? "text-xs text-[#3fb950]"
              : "text-xs text-[#e3b341]"
          }
          role="status"
        >
          {isPublic ? tWizard("badgePublicOk") : tWizard("badgeDmOnly")}
          {" — "}
          {isPublic
            ? tWizard("sharingReminderPublic")
            : tWizard("sharingReminderDm")}
        </p>
      ) : null}
    </div>
  );
}
