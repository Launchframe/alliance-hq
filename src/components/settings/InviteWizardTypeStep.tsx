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
        <p className="mt-1 text-sm text-hq-fg-muted">{t("typeStepHint")}</p>
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
                  ? "rounded-lg border border-hq-accent bg-hq-accent/10 p-4 text-left transition-colors"
                  : "rounded-lg border border-hq-border bg-hq-surface p-4 text-left transition-colors hover:border-hq-border"
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-hq-fg">
                  {t(typeTitleKey(type))}
                </span>
                <span
                  className={
                    type === "join_code"
                      ? "rounded-full border border-hq-success/40 bg-hq-success/10 px-2 py-0.5 text-xs font-medium text-hq-success"
                      : "rounded-full border border-hq-warning/40 bg-hq-warning/10 px-2 py-0.5 text-xs font-medium text-hq-warning"
                  }
                >
                  {t(typeBadgeKey(type))}
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-hq-fg-muted">
                {t(typeBodyKey(type))}
              </p>
            </button>
          );
        })}
      </div>

      <p className="text-xs text-hq-fg-subtle">{t("ashedSeatInfo")}</p>
      <p className="text-xs">
        <Link href="/guides/officer-invite-types" className="text-hq-accent hover:underline">
          {t("fullGuideLink")}
        </Link>
      </p>
    </div>
  );
}
