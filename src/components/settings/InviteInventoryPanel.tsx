"use client";

import { Check, ChevronLeft, ChevronRight, Copy, Eye } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { useFormatAccountDateTime } from "@/components/timezone/TimezoneProvider";
import { AppSelect } from "@/components/ui/AppSelect";
import type {
  InventoryAllianceOption,
  InviteInventoryDepletedReason,
  InviteInventoryItem,
  InviteInventoryPayload,
  InventoryFilterKind,
} from "@/lib/native-alliance/invite-inventory.shared";
import { matchesInventoryDateRange } from "@/lib/native-alliance/invite-inventory.shared";

const PAGE_SIZE = 15;

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

function CodeHintReveal({ hint }: { hint: string }) {
  const tCommon = useTranslations("common");
  const tInvites = useTranslations("team.invites");
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(hint);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — ignore
    }
  }

  if (!revealed) {
    return (
      <button
        type="button"
        onClick={() => setRevealed(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-hq-border bg-hq-surface-muted px-2.5 py-1 text-xs text-hq-fg-muted transition-colors hover:bg-hq-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hq-accent"
      >
        <Eye aria-hidden className="h-3.5 w-3.5" />
        {tInvites("inventoryRevealCode")}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-xs text-hq-fg">{hint}</span>
      <button
        type="button"
        onClick={() => void handleCopy()}
        className="inline-flex items-center gap-1.5 rounded-md border border-hq-border bg-hq-surface-muted px-2.5 py-1 text-xs transition-colors hover:bg-hq-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hq-accent"
        aria-label={tCommon("copyToClipboard")}
      >
        {copied ? (
          <>
            <Check aria-hidden className="h-3.5 w-3.5 text-hq-green" />
            <span className="text-hq-green">{tCommon("copied")}</span>
          </>
        ) : (
          <>
            <Copy aria-hidden className="h-3.5 w-3.5" />
            <span>{tCommon("copy")}</span>
          </>
        )}
      </button>
    </div>
  );
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
          </p>
          {item.adminLabel ? (
            <p className="text-xs text-hq-fg-muted">{item.adminLabel}</p>
          ) : null}
          {item.codeHint ? (
            <div className="mt-1.5">
              <CodeHintReveal hint={item.codeHint} />
            </div>
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
      {!depleted && item.kind === "invite_link" ? (
        <p className="mt-2 text-xs text-hq-fg-muted">
          {t("inventoryInviteLinkNotRetrievable")}
        </p>
      ) : null}
    </li>
  );
}

type InventoryApiResponse = {
  error?: string;
  inventory?: InviteInventoryPayload;
  alliances?: InventoryAllianceOption[];
  currentAllianceId?: string;
};

export function InviteInventoryPanel({ refreshToken = 0 }: Props) {
  const t = useTranslations("team.invites");

  const [tab, setTab] = useState<InventoryTab>("valid");
  const [inventory, setInventory] = useState<InviteInventoryPayload | null>(null);
  const [alliances, setAlliances] = useState<InventoryAllianceOption[]>([]);
  const [selectedAllianceId, setSelectedAllianceId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [typeFilter, setTypeFilter] = useState<InventoryFilterKind>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  const fetchInventory = useCallback(
    async (allianceId?: string): Promise<InventoryApiResponse> => {
      const url = allianceId
        ? `/api/settings/team/invites/inventory?allianceId=${encodeURIComponent(allianceId)}`
        : "/api/settings/team/invites/inventory";
      const res = await fetch(url);
      const body = (await res.json()) as InventoryApiResponse;
      if (!res.ok) {
        throw new Error(body.error ?? t("inventoryLoadFailed"));
      }
      return body;
    },
    [t],
  );

  // Tracks the last alliance ID whose data is already loaded, to prevent
  // double-fetching when the initial load programmatically sets selectedAllianceId.
  const loadedAllianceRef = useRef("");

  // Initial load and refreshToken-driven reload
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchInventory(selectedAllianceId || undefined);
        if (cancelled) return;
        setInventory(data.inventory ?? { valid: [], depleted: [] });
        if (data.alliances) setAlliances(data.alliances);
        if (data.currentAllianceId) {
          loadedAllianceRef.current = data.currentAllianceId;
          setSelectedAllianceId(data.currentAllianceId);
        }
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t("inventoryLoadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  // Intentionally omits selectedAllianceId — user alliance switches handled separately
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchInventory, refreshToken, t]);

  // User-driven alliance switch: reload only when the user picks a different alliance
  useEffect(() => {
    if (!selectedAllianceId) return;
    if (selectedAllianceId === loadedAllianceRef.current) return;
    loadedAllianceRef.current = selectedAllianceId;
    let cancelled = false;

    void (async () => {
      setPage(1);
      setLoading(true);
      setError(null);
      try {
        const data = await fetchInventory(selectedAllianceId);
        if (cancelled) return;
        setInventory(data.inventory ?? { valid: [], depleted: [] });
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t("inventoryLoadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchInventory, selectedAllianceId, t]);

  const filtered = useMemo(() => {
    const source =
      tab === "valid" ? inventory?.valid ?? [] : inventory?.depleted ?? [];
    return source.filter((item) => {
      if (typeFilter !== "all" && item.kind !== typeFilter) return false;
      if (!matchesInventoryDateRange(item.createdAt, dateFrom || null, dateTo || null))
        return false;
      return true;
    });
  }, [inventory, tab, typeFilter, dateFrom, dateTo]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const allianceOptions = alliances.map((a) => ({
    value: a.id,
    label: a.tag ? `[${a.tag}] ${a.name}` : a.name,
    searchText: `${a.tag ?? ""} ${a.name}`.trim(),
  }));

  const typeOptions = [
    { value: "all", label: t("inventoryFilterTypeAll") },
    { value: "invite_link", label: t("inventoryKindInviteLink") },
    { value: "join_code", label: t("inventoryKindJoinCode") },
    { value: "commander_claim", label: t("inventoryKindClaim") },
  ];

  function handleAllianceChange(id: string) {
    if (id !== selectedAllianceId) {
      setSelectedAllianceId(id);
    }
  }

  function handleTabChange(next: InventoryTab) {
    setTab(next);
    setPage(1);
  }

  function handleTypeChange(next: string) {
    setTypeFilter(next as InventoryFilterKind);
    setPage(1);
  }

  function handleDateFromChange(next: string) {
    setDateFrom(next);
    setPage(1);
  }

  function handleDateToChange(next: string) {
    setDateTo(next);
    setPage(1);
  }

  function hasActiveFilters() {
    return typeFilter !== "all" || dateFrom !== "" || dateTo !== "";
  }

  function resetFilters() {
    setTypeFilter("all");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">{t("inventoryTitle")}</h3>
        <p className="mt-1 text-sm text-hq-fg-muted">{t("inventoryHint")}</p>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3">
        {alliances.length > 1 ? (
          <div className="min-w-[180px] max-w-[260px] flex-1">
            <label className="mb-1 block text-xs text-hq-fg-muted">
              {t("inventoryFilterAlliance")}
            </label>
            <AppSelect
              value={selectedAllianceId}
              onChange={handleAllianceChange}
              options={allianceOptions}
              searchable
              combobox
              searchPlaceholder={t("inventoryFilterAlliancePlaceholder")}
              noSearchResultsLabel={t("inventoryFilterAllianceNoResults")}
              aria-label={t("inventoryFilterAlliance")}
            />
          </div>
        ) : null}

        <div className="min-w-[140px] flex-1">
          <label className="mb-1 block text-xs text-hq-fg-muted">
            {t("inventoryFilterType")}
          </label>
          <AppSelect
            value={typeFilter}
            onChange={handleTypeChange}
            options={typeOptions}
            aria-label={t("inventoryFilterType")}
          />
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs text-hq-fg-muted">
              {t("inventoryFilterDateFrom")}
            </label>
            <input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => handleDateFromChange(e.target.value)}
              className="rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hq-accent"
              aria-label={t("inventoryFilterDateFrom")}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-hq-fg-muted">
              {t("inventoryFilterDateTo")}
            </label>
            <input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => handleDateToChange(e.target.value)}
              className="rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hq-accent"
              aria-label={t("inventoryFilterDateTo")}
            />
          </div>
          {hasActiveFilters() ? (
            <button
              type="button"
              onClick={resetFilters}
              className="rounded-lg border border-hq-border bg-hq-surface-muted px-3 py-2 text-sm text-hq-fg-muted transition-colors hover:bg-hq-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hq-accent"
            >
              {t("inventoryFilterReset")}
            </button>
          ) : null}
        </div>
      </div>

      {/* Valid / Depleted tabs */}
      <div
        className="inline-flex rounded-lg border border-hq-border p-0.5 text-sm"
        role="tablist"
        aria-label={t("inventoryTitle")}
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "valid"}
          onClick={() => handleTabChange("valid")}
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
          onClick={() => handleTabChange("depleted")}
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

      {!loading && !error && filtered.length === 0 ? (
        <p className="text-sm text-hq-fg-muted">
          {hasActiveFilters()
            ? t("inventoryFilterNoResults")
            : tab === "valid"
              ? t("inventoryEmptyValid")
              : t("inventoryEmptyDepleted")}
        </p>
      ) : null}

      {!loading && !error && pageRows.length > 0 ? (
        <ul className="space-y-2">
          {pageRows.map((item) => (
            <InventoryRow
              key={`${item.kind}-${item.id}`}
              item={item}
              depleted={tab === "depleted"}
            />
          ))}
        </ul>
      ) : null}

      {/* Pagination */}
      {!loading && !error && pageCount > 1 ? (
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="inline-flex items-center gap-1 rounded-md border border-hq-border bg-hq-surface-muted px-3 py-1.5 text-sm text-hq-fg-muted transition-colors hover:bg-hq-border disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hq-accent"
            aria-label={t("inventoryPagePrev")}
          >
            <ChevronLeft aria-hidden className="h-4 w-4" />
            {t("inventoryPagePrev")}
          </button>
          <span className="text-xs text-hq-fg-muted">
            {t("inventoryPageInfo", { page, total: pageCount })}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={page >= pageCount}
            className="inline-flex items-center gap-1 rounded-md border border-hq-border bg-hq-surface-muted px-3 py-1.5 text-sm text-hq-fg-muted transition-colors hover:bg-hq-border disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hq-accent"
            aria-label={t("inventoryPageNext")}
          >
            {t("inventoryPageNext")}
            <ChevronRight aria-hidden className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
