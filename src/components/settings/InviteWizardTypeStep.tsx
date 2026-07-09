"use client";

import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

import type { InviteWizardType } from "@/lib/settings/invite-wizard.shared";

type Props = {
  selected: InviteWizardType | null;
  onSelect: (type: InviteWizardType) => void;
};

const TYPES: InviteWizardType[] = [
  "invite_link",
  "join_code",
  "commander_claim",
];

function typeTitleKey(
  type: InviteWizardType,
): "typeInviteLinkTitle" | "typeJoinCodeTitle" | "typeClaimTitle" {
  if (type === "invite_link") return "typeInviteLinkTitle";
  if (type === "join_code") return "typeJoinCodeTitle";
  return "typeClaimTitle";
}

function typeBodyKey(
  type: InviteWizardType,
): "typeInviteLinkBody" | "typeJoinCodeBody" | "typeClaimBody" {
  if (type === "invite_link") return "typeInviteLinkBody";
  if (type === "join_code") return "typeJoinCodeBody";
  return "typeClaimBody";
}

function typeBadgeKey(
  type: InviteWizardType,
): "badgeDmOnly" | "badgePublicOk" {
  return type === "join_code" ? "badgePublicOk" : "badgeDmOnly";
}

export function InviteWizardTypeStep({ selected, onSelect }: Props) {
  const t = useTranslations("team.invites.wizard");

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">{t("typeStepTitle")}</h3>
        <p className="mt-1 text-sm text-[#8b949e]">{t("typeStepHint")}</p>
      </div>

      <div
        className="grid gap-3"
        role="radiogroup"
        aria-label={t("typeStepTitle")}
      >
        {TYPES.map((type) => {
          const isSelected = selected === type;
          return (
            <button
              key={type}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onSelect(type)}
              className={
                isSelected
                  ? "rounded-lg border border-[#388bfd] bg-[#388bfd]/10 p-4 text-left transition-colors"
                  : "rounded-lg border border-[#30363d] bg-[#0d1117]/50 p-4 text-left transition-colors hover:border-[#484f58]"
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-[#e6edf3]">
                  {t(typeTitleKey(type))}
                </span>
                <span
                  className={
                    type === "join_code"
                      ? "rounded-full border border-[#238636]/40 bg-[#238636]/10 px-2 py-0.5 text-xs font-medium text-[#3fb950]"
                      : "rounded-full border border-[#e3b341]/40 bg-[#e3b341]/10 px-2 py-0.5 text-xs font-medium text-[#e3b341]"
                  }
                >
                  {t(typeBadgeKey(type))}
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-[#8b949e]">
                {t(typeBodyKey(type))}
              </p>
            </button>
          );
        })}
      </div>

      <p className="text-xs text-[#6e7681]">{t("ashedSeatInfo")}</p>
      <p className="text-xs">
        <Link href="/guides/officer-invite-types" className="text-[#58a6ff] hover:underline">
          {t("fullGuideLink")}
        </Link>
      </p>
    </div>
  );
}
