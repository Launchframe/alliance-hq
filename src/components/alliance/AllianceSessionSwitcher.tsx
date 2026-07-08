"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { AllianceLinkedCommandersBadge } from "@/components/alliance/AllianceLinkedCommandersBadge";
import { AlliancePickerOptionLabel } from "@/components/alliance/AlliancePickerOptionLabel";
import { AppSelect } from "@/components/ui/AppSelect";
import { alliancePickerOptionSearchText } from "@/lib/alliance/alliance-picker-label.shared";
import { resolveAllianceSwitchTargetPath } from "@/lib/alliance/switch-nav.shared";
import type { SessionAllianceOption } from "@/lib/alliance/types";
import { getPathname, usePathname } from "@/i18n/navigation";

type Props = {
  initialCurrentAllianceId?: string | null;
  initialAlliances?: SessionAllianceOption[];
  /** Alliance highlighted elsewhere (e.g. admin table row) — offers a one-click switch. */
  switchTargetAllianceId?: string | null;
  /** Stay on the current page after switching instead of alliance landing redirect. */
  stayOnCurrentPage?: boolean;
  initialIsPlatformMaintainer?: boolean;
  searchable?: boolean;
  className?: string;
  onSwitched?: (allianceId: string) => void;
};

export function AllianceSessionSwitcher({
  initialCurrentAllianceId = null,
  initialAlliances = [],
  switchTargetAllianceId = null,
  stayOnCurrentPage = false,
  initialIsPlatformMaintainer = false,
  searchable: searchableProp,
  className,
  onSwitched,
}: Props) {
  const t = useTranslations("alliancePicker");
  const locale = useLocale();
  const pathname = usePathname();
  const [alliances, setAlliances] = useState(initialAlliances);
  const [currentAllianceId, setCurrentAllianceId] = useState(
    initialCurrentAllianceId ?? "",
  );
  const [isPlatformMaintainer, setIsPlatformMaintainer] = useState(
    initialIsPlatformMaintainer,
  );
  const [loading, setLoading] = useState(initialAlliances.length === 0);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchTarget = switchTargetAllianceId
    ? alliances.find((row) => row.id === switchTargetAllianceId)
    : null;
  const showSwitchTargetButton =
    Boolean(
      switchTarget &&
        switchTargetAllianceId &&
        switchTargetAllianceId !== currentAllianceId,
    );

  useEffect(() => {
    if (initialAlliances.length > 0) {
      return;
    }

    let cancelled = false;

    void (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/session/alliances");
        const data = (await res.json()) as {
          error?: string;
          alliances?: SessionAllianceOption[];
          currentAllianceId?: string | null;
          isPlatformMaintainer?: boolean;
        };
        if (!res.ok) {
          throw new Error(data.error ?? t("loadFailed"));
        }
        if (cancelled) return;
        setAlliances(data.alliances ?? []);
        setIsPlatformMaintainer(data.isPlatformMaintainer ?? false);
        if (data.currentAllianceId) {
          setCurrentAllianceId(data.currentAllianceId);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t("loadFailed"));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initialAlliances.length, t]);

  const onSelect = useCallback(
    async (allianceId: string) => {
      if (!allianceId || allianceId === currentAllianceId) {
        return;
      }
      setSwitching(true);
      setError(null);
      try {
        const res = await fetch("/api/session/current-alliance", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ allianceId }),
        });
        const data = (await res.json()) as {
          error?: string;
          currentAllianceId?: string;
          operatingMode?: "ashed" | "native";
          redirectPath?: string;
        };
        if (!res.ok) {
          throw new Error(data.error ?? t("switchFailed"));
        }
        const nextId = data.currentAllianceId ?? allianceId;
        setCurrentAllianceId(nextId);
        onSwitched?.(nextId);

        if (stayOnCurrentPage) {
          window.location.reload();
          return;
        }

        const apiRedirect = data.redirectPath ?? "/members";
        const targetPath = resolveAllianceSwitchTargetPath({
          currentPath: pathname,
          apiRedirectPath: apiRedirect,
          targetOperatingMode: data.operatingMode ?? null,
        });
        const localizedTarget = getPathname({ href: targetPath, locale });

        // Same-URL assign can skip a full document load, leaving app-shell nav props stale.
        if (
          localizedTarget === window.location.pathname ||
          targetPath === pathname
        ) {
          window.location.reload();
          return;
        }

        window.location.assign(localizedTarget);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("switchFailed"));
      } finally {
        setSwitching(false);
      }
    },
    [currentAllianceId, locale, onSwitched, pathname, stayOnCurrentPage, t],
  );

  const searchable =
    searchableProp ?? (isPlatformMaintainer || alliances.length > 8);

  if (loading) {
    return (
      <div className={`text-xs text-hq-fg-muted ${className ?? ""}`.trim()}>
        {t("loading")}
      </div>
    );
  }

  if (alliances.length === 0) {
    return null;
  }

  const activeBadgeLabel = t("activeBadge");

  if (alliances.length === 1 && !isPlatformMaintainer) {
    const only = alliances[0]!;
    const label = only.tag ?? only.slug;
    return (
      <div className={className}>
        <p className="truncate text-sm font-medium text-hq-fg">
          {label}
          {only.name && only.name !== label ? (
            <span className="font-normal text-hq-fg-muted"> — {only.name}</span>
          ) : null}
          {only.hasLinkedCommanders ? (
            <span className="ml-2 inline-flex align-middle">
              <AllianceLinkedCommandersBadge label={activeBadgeLabel} />
            </span>
          ) : null}
        </p>
        {only.roleName ? (
          <p className="mt-0.5 text-xs capitalize text-hq-fg-muted">
            {only.roleName}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={className}>
      <AppSelect
        value={currentAllianceId}
        onChange={(next) => void onSelect(next)}
        disabled={switching}
        searchable={searchable}
        searchMode="substring"
        searchPlaceholder={t("searchPlaceholder")}
        noSearchResultsLabel={t("searchNoMatches")}
        placeholder={t("placeholder")}
        aria-label={t("label")}
        options={alliances.map((alliance) => ({
          value: alliance.id,
          label: (
            <AlliancePickerOptionLabel
              alliance={alliance}
              activeBadgeLabel={activeBadgeLabel}
            />
          ),
          searchText: alliancePickerOptionSearchText(alliance),
        }))}
      />
      {showSwitchTargetButton && switchTarget ? (
        <button
          type="button"
          disabled={switching}
          onClick={() => void onSelect(switchTargetAllianceId!)}
          className="mt-2 w-full rounded-lg border border-[#388bfd] bg-[#388bfd]/10 px-3 py-2 text-sm text-hq-accent hover:bg-[#388bfd]/20 disabled:opacity-50 sm:w-auto"
        >
          {t("switchToSelected", {
            tag: switchTarget.tag ?? switchTarget.slug,
          })}
        </button>
      ) : null}
      {error ? <p className="mt-1 text-xs text-hq-danger">{error}</p> : null}
    </div>
  );
}
