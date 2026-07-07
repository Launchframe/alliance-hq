"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";

import { AppSelect } from "@/components/ui/AppSelect";
import { useRouter } from "@/i18n/navigation";
import type { SessionAllianceOption } from "@/lib/alliance/types";

type Props = {
  alliances: SessionAllianceOption[];
};

export function AllianceContextRequired({ alliances }: Props) {
  const t = useTranslations("settings.allianceContext");
  const router = useRouter();
  const [allianceId, setAllianceId] = useState("");
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSelect = useCallback(
    async (nextAllianceId: string) => {
      if (!nextAllianceId) {
        return;
      }
      setSwitching(true);
      setError(null);
      try {
        const res = await fetch("/api/session/current-alliance", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ allianceId: nextAllianceId }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          throw new Error(data.error ?? t("switchFailed"));
        }
        setAllianceId(nextAllianceId);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("switchFailed"));
      } finally {
        setSwitching(false);
      }
    },
    [router, t],
  );

  return (
    <div className="mx-auto max-w-lg rounded-xl border border-hq-border bg-hq-surface p-6">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <p className="mt-2 text-sm text-hq-fg-muted">{t("body")}</p>
      <label className="mt-4 block min-w-0">
        <span className="mb-1 block text-sm text-hq-fg-muted">{t("label")}</span>
        <AppSelect
          value={allianceId}
          onChange={(next) => void onSelect(next)}
          disabled={switching}
          placeholder={t("placeholder")}
          aria-label={t("label")}
          options={alliances.map((alliance) => ({
            value: alliance.id,
            label: `${alliance.tag ?? alliance.slug}${alliance.name ? ` — ${alliance.name}` : ""} (${alliance.roleName})`,
          }))}
        />
      </label>
      {error ? <p className="mt-2 text-sm text-hq-danger">{error}</p> : null}
    </div>
  );
}
