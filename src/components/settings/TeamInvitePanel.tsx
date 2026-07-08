"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { InviteWizard } from "@/components/settings/InviteWizard";
import type { SystemRoleName } from "@/lib/rbac/constants";

type Props = {
  assignableRoles: SystemRoleName[];
  allianceName: string;
};

function InviteWizardWithParams({
  assignableRoles,
  allianceName,
}: Props) {
  const searchParams = useSearchParams();
  const deepLinkClaimCommanderId =
    searchParams.get("inviteWizard") === "claim"
      ? searchParams.get("commander")
      : null;

  return (
    <InviteWizard
      assignableRoles={assignableRoles}
      allianceName={allianceName}
      deepLinkClaimCommanderId={deepLinkClaimCommanderId}
    />
  );
}

export function TeamInvitePanel({ assignableRoles, allianceName }: Props) {
  const t = useTranslations("team.invites");

  return (
    <div className="space-y-6 rounded-xl border border-hq-border bg-hq-surface p-5">
      <div>
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="mt-1 text-sm text-hq-fg-muted">{t("description")}</p>
      </div>

      <Suspense
        fallback={
          <p className="text-sm text-hq-fg-muted">{t("wizard.loading")}</p>
        }
      >
        <InviteWizardWithParams
          assignableRoles={assignableRoles}
          allianceName={allianceName}
        />
      </Suspense>
    </div>
  );
}
