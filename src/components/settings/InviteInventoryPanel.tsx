"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { useFormatAccountDateTime } from "@/components/timezone/TimezoneProvider";
import type {
  InviteInventoryDepletedReason,
  InviteInventoryItem,
  InviteInventoryPayload,
} from "@/lib/native-alliance/invite-inventory.shared";

type InventoryTab = "valid" | "depleted";

type Props = {
  refreshToken?: number;
};

const ROLE_LABEL_KEYS = {
  owner: "roleOwner",
  maintainer: "roleMaintainer",
  officer: "roleOfficer",
  data_entry: "roleDataEntry",
  viewer: "roleViewer",
  member: "roleMember",
} as const;

function kindLabelKey(
  item: InviteInventoryItem,
): "inventoryKindInviteLink" | "inventoryKindJoinCode" | "inventoryKindClaim" {
  if (item.kind === "invite_link") return "inventoryKindInviteLink";
  if (item.kind === "commander_claim") return "inventoryKindClaim";
  return "inventoryKindJoinCode";
}

function depletedReasonKey(
  reason: InviteInventoryDepletedReason,
):
  | "inventoryDepletedExpired"
  | "inventoryDepletedRevoked"
  | "inventoryDepletedUsesExhausted"
  | "inventoryDepletedAccepted" {
  if (reason === "revoked") return "inventoryDepletedRevoked";
  if (reason === "uses_exhausted") return "inventoryDepletedUsesExhausted";
  if (reason === "accepted") return "inventoryDepletedAccepted";
  return "inventoryDepletedExpired";
}

function InventoryRow({
  item,
  depleted,
}: {
  item: InviteInventoryItem;
  depleted: boolean;
}) {
  const t = useTranslations("team.invites");
  const formatDateTime = useFormatAccountDateTime();

  const roleLabel = t(
    ROLE_LABEL_KEYS[item.roleName as keyof typeof ROLE_LABEL_KEYS] ??
      "roleMember",
  );

  const usesLine =
    item.maxRedemptions != null && item.redemptionCount != null
      ? t("inventoryUsesLine", {
          remaining: item.usesRemaining ?? 0,
          max: item.maxRedemptions,
          used: item.redemptionCount,
        })
      : null;

  return (
    <li className="rounded-lg border border-hq-border bg-hq-surface-muted/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-hq-fg">
            {t(kindLabelKey(item))}
            {item.targetCommanderName
              ? ` · ${item.targetCommanderName}`
              : null}
          </p>
          <p className="text-xs text-hq-fg-muted">
            {roleLabel}
            {item.email ? ` · ${item.email}` : null}
            {item.codeHint ? ` · ${item.codeHint}` : null}
          </p>
          {item.adminLabel ? (
            <p className="text-xs text-hq-fg-muted">{item.adminLabel}</p>
          ) : null}
        </div>
        <div className="text-right text-xs text-hq-fg-muted">
          <p>{formatDateTime(new Date(item.createdAt))}</p>
          <p>
            {t("inventoryExpires", {
              date: formatDateTime(new Date(item.expiresAt)),
            })}
          </p>
        </div>
      </div>
      {usesLine ? (
        <p className="mt-2 text-xs text-hq-fg-muted">{usesLine}</p>
      ) : null}
      {item.kind === "invite_link" && item.status === "valid" ? (
        <p className="mt-2 text-xs text-hq-fg-muted">
          {t("inventoryInvitePending")}
        </p>
      ) : null}
      {depleted && item.depletedReason ? (
        <p className="mt-2 text-xs text-hq-warning">
          {t(depletedReasonKey(item.depletedReason))}
        </p>
      ) : null}
      {!depleted && item.kind !== "invite_link" ? (
        <p className="mt-2 text-xs text-hq-fg-muted">
          {t("inventoryCodeHintOnly")}
        </p>
      ) : null}
      {!depleted && item.kind === "invite_link" ? (
        <p className="mt-2 text-xs text-hq-fg-muted">
          {t("inventoryInviteLinkNotRetrievable")}
        </p>
      ) : null}
    </li>
  );
}

export function InviteInventoryPanel({ refreshToken = 0 }: Props) {
  const t = useTranslations("team.invites");
  const [tab, setTab] = useState<InventoryTab>("valid");
  const [inventory, setInventory] = useState<InviteInventoryPayload | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchInventory = useCallback(async (): Promise<InviteInventoryPayload> => {
    const res = await fetch("/api/settings/team/invites/inventory");
    const body = (await res.json()) as {
      error?: string;
      inventory?: InviteInventoryPayload;
    };
    if (!res.ok) {
      throw new Error(body.error ?? t("inventoryLoadFailed"));
    }
    return body.inventory ?? { valid: [], depleted: [] };
  }, [t]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const nextInventory = await fetchInventory();
        if (cancelled) return;
        setInventory(nextInventory);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t("inventoryLoadFailed"));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchInventory, refreshToken, t]);

  const rows = tab === "valid" ? inventory?.valid ?? [] : inventory?.depleted ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">{t("inventoryTitle")}</h3>
        <p className="mt-1 text-sm text-hq-fg-muted">{t("inventoryHint")}</p>
      </div>

      <div
        className="inline-flex rounded-lg border border-hq-border p-0.5 text-sm"
        role="tablist"
        aria-label={t("inventoryTitle")}
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "valid"}
          onClick={() => setTab("valid")}
          className={
            tab === "valid"
              ? "rounded-md bg-hq-accent/15 px-3 py-1 text-hq-accent"
              : "rounded-md px-3 py-1 text-hq-fg-muted"
          }
        >
          {t("inventoryTabValid")}
          {inventory ? (
            <span className="ml-1.5 text-xs opacity-80">
              ({inventory.valid.length})
            </span>
          ) : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "depleted"}
          onClick={() => setTab("depleted")}
          className={
            tab === "depleted"
              ? "rounded-md bg-hq-accent/15 px-3 py-1 text-hq-accent"
              : "rounded-md px-3 py-1 text-hq-fg-muted"
          }
        >
          {t("inventoryTabDepleted")}
          {inventory ? (
            <span className="ml-1.5 text-xs opacity-80">
              ({inventory.depleted.length})
            </span>
          ) : null}
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-hq-fg-muted">{t("inventoryLoading")}</p>
      ) : null}
      {error ? (
        <p className="text-sm text-hq-danger" role="alert">
          {error}
        </p>
      ) : null}

      {!loading && !error && rows.length === 0 ? (
        <p className="text-sm text-hq-fg-muted">
          {tab === "valid"
            ? t("inventoryEmptyValid")
            : t("inventoryEmptyDepleted")}
        </p>
      ) : null}

      {!loading && !error && rows.length > 0 ? (
        <ul className="space-y-2">
          {rows.map((item) => (
            <InventoryRow
              key={`${item.kind}-${item.id}`}
              item={item}
              depleted={tab === "depleted"}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
