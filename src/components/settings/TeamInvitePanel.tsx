"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { InviteInventoryPanel } from "@/components/settings/InviteInventoryPanel";
import { InviteWizard } from "@/components/settings/InviteWizard";
import type { SystemRoleName } from "@/lib/rbac/constants";

type Props = {
  assignableRoles: SystemRoleName[];
  allianceName: string;
};

type PanelMode = "create" | "view";

function InviteWizardWithParams({
  assignableRoles,
  allianceName,
  onGenerated,
}: Props & { onGenerated: () => void }) {
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
      onGenerated={onGenerated}
    />
  );
}

export function TeamInvitePanel({ assignableRoles, allianceName }: Props) {
  const t = useTranslations("team.invites");
  const [panelMode, setPanelMode] = useState<PanelMode>("create");
  const [inventoryRefreshToken, setInventoryRefreshToken] = useState(0);

  function bumpInventoryRefresh() {
    setInventoryRefreshToken((value) => value + 1);
  }

  return (
    <div className="space-y-6 rounded-xl border border-hq-border bg-hq-surface p-5">
      <div>
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="mt-1 text-sm text-hq-fg-muted">{t("description")}</p>
      </div>

      <div
        className="inline-flex rounded-lg border border-hq-border p-0.5 text-sm"
        role="tablist"
        aria-label={t("panelModeLabel")}
      >
        <button
          type="button"
          role="tab"
          aria-selected={panelMode === "create"}
          onClick={() => setPanelMode("create")}
          className={
            panelMode === "create"
              ? "rounded-md bg-hq-accent/15 px-3 py-1.5 text-hq-accent"
              : "rounded-md px-3 py-1.5 text-hq-fg-muted"
          }
        >
          {t("panelTabCreate")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={panelMode === "view"}
          onClick={() => setPanelMode("view")}
          className={
            panelMode === "view"
              ? "rounded-md bg-hq-accent/15 px-3 py-1.5 text-hq-accent"
              : "rounded-md px-3 py-1.5 text-hq-fg-muted"
          }
        >
          {t("panelTabView")}
        </button>
      </div>

      {panelMode === "create" ? (
        <Suspense
          fallback={
            <p className="text-sm text-hq-fg-muted">{t("wizard.loading")}</p>
          }
        >
          <InviteWizardWithParams
            assignableRoles={assignableRoles}
            allianceName={allianceName}
            onGenerated={bumpInventoryRefresh}
          />
        </Suspense>
      ) : (
        <InviteInventoryPanel refreshToken={inventoryRefreshToken} />
      )}
    </div>
  );
}
