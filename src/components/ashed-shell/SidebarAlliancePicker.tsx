"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { AppSelect } from "@/components/ui/AppSelect";
import { getPathname } from "@/i18n/navigation";
import type { SessionAllianceOption } from "@/lib/alliance/types";

type Props = {
  initialCurrentAllianceId?: string | null;
  initialAlliances?: SessionAllianceOption[];
};

export function SidebarAlliancePicker({
  initialCurrentAllianceId = null,
  initialAlliances = [],
}: Props) {
  const t = useTranslations("alliancePicker");
  const locale = useLocale();
  const [alliances, setAlliances] = useState(initialAlliances);
  const [currentAllianceId, setCurrentAllianceId] = useState(
    initialCurrentAllianceId ?? "",
  );
  const [loading, setLoading] = useState(initialAlliances.length === 0);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        };
        if (!res.ok) {
          throw new Error(data.error ?? t("loadFailed"));
        }
        if (cancelled) return;
        setAlliances(data.alliances ?? []);
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
          redirectPath?: string;
        };
        if (!res.ok) {
          throw new Error(data.error ?? t("switchFailed"));
        }
        setCurrentAllianceId(data.currentAllianceId ?? allianceId);
        const redirectPath = data.redirectPath ?? "/members";
        window.location.assign(getPathname({ href: redirectPath, locale }));
      } catch (err) {
        setError(err instanceof Error ? err.message : t("switchFailed"));
      } finally {
        setSwitching(false);
      }
    },
    [currentAllianceId, locale, t],
  );

  if (loading) {
    return (
      <div className="border-b border-[#30363d] px-3 py-3 text-xs text-[#8b949e]">
        {t("loading")}
      </div>
    );
  }

  if (alliances.length === 0) {
    return null;
  }

  const current = alliances.find((a) => a.id === currentAllianceId);

  if (alliances.length === 1) {
    const only = alliances[0]!;
    const label = only.tag ?? only.slug;
    return (
      <div className="border-b border-[#30363d] px-3 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6e7681]">
          {t("label")}
        </p>
        <p className="mt-1 truncate text-sm font-medium text-[#e6edf3]">
          {label}
          {only.name && only.name !== label ? (
            <span className="font-normal text-[#8b949e]"> — {only.name}</span>
          ) : null}
        </p>
        <p className="mt-0.5 text-xs capitalize text-[#8b949e]">
          {only.roleName}
        </p>
      </div>
    );
  }

  return (
    <div className="border-b border-[#30363d] px-3 py-3">
      <label className="block min-w-0">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[#6e7681]">
          {t("label")}
        </span>
        <AppSelect
          value={currentAllianceId}
          onChange={(next) => void onSelect(next)}
          disabled={switching}
          placeholder={t("placeholder")}
          aria-label={t("label")}
          options={alliances.map((alliance) => ({
            value: alliance.id,
            label: `${alliance.tag ?? alliance.slug}${alliance.name ? ` — ${alliance.name}` : ""} (${alliance.roleName})`,
          }))}
        />
        {current?.tag && currentAllianceId ? (
          <p className="mt-1 truncate text-xs text-[#8b949e]">
            {t("contextHint", { tag: current.tag ?? current.slug })}
          </p>
        ) : null}
        {error ? (
          <p className="mt-1 text-xs text-[#f85149]">{error}</p>
        ) : null}
      </label>
    </div>
  );
}
