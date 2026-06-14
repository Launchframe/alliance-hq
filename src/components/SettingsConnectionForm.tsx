"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { AlliancePicker } from "@/components/AlliancePicker";
import { useRouter } from "@/i18n/navigation";
import { TokenExpiryNotice } from "@/components/TokenExpiryNotice";
import { ashedLink, strongText } from "@/components/i18n/richText";
import type { AccessibleAlliance } from "@/lib/alliance/types";
import type { AshedConnectionMeta } from "@/lib/jwt/connection-meta";
import { DEFAULT_EXPIRY_REMINDER_DAYS } from "@/lib/jwt/decode";

const REMINDER_OPTIONS = [7, 14, 21, 30];

type Props = {
  initialAshed: AshedConnectionMeta | null;
  initialAllianceId?: string | null;
};

export function SettingsConnectionForm({
  initialAshed,
  initialAllianceId,
}: Props) {
  const t = useTranslations("settings");
  const tToken = useTranslations("tokenExpiry");
  const tc = useTranslations("common");
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ashed, setAshed] = useState(initialAshed);
  const [reminderDays, setReminderDays] = useState(
    initialAshed?.expiryReminderDays ?? DEFAULT_EXPIRY_REMINDER_DAYS,
  );
  const [accessibleAlliances, setAccessibleAlliances] = useState<
    AccessibleAlliance[]
  >([]);
  const [selectedAllianceId, setSelectedAllianceId] = useState(
    initialAllianceId ?? "",
  );
  const [alliancesLoading, setAlliancesLoading] = useState(true);
  const [alliancesError, setAlliancesError] = useState<string | null>(null);
  const [allianceSaving, setAllianceSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setAlliancesLoading(true);
      setAlliancesError(null);

      try {
        const res = await fetch("/api/settings/connection");
        const data = (await res.json()) as {
          error?: string;
          accessibleAlliances?: AccessibleAlliance[];
          selectedAllianceId?: string | null;
        };
        if (!res.ok) {
          throw new Error(data.error ?? t("allianceLoadFailed"));
        }
        if (cancelled) return;
        setAccessibleAlliances(data.accessibleAlliances ?? []);
        if (data.selectedAllianceId) {
          setSelectedAllianceId(data.selectedAllianceId);
        } else if (data.accessibleAlliances?.length === 1) {
          setSelectedAllianceId(data.accessibleAlliances[0].id);
        }
      } catch (err) {
        if (cancelled) return;
        setAlliancesError(
          err instanceof Error ? err.message : t("allianceLoadFailed"),
        );
      } finally {
        if (!cancelled) {
          setAlliancesLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [t]);

  async function saveAlliance() {
    if (!selectedAllianceId) {
      setMessage(t("allianceRequired"));
      return;
    }
    setAllianceSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/connection", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allianceId: selectedAllianceId }),
      });
      const data = (await res.json()) as {
        error?: string;
        alliance?: { tag: string; name?: string };
      };
      if (!res.ok) {
        setMessage(data.error ?? t("allianceSaveFailed"));
        return;
      }
      setMessage(
        data.alliance
          ? t("allianceSaved", {
              tag: data.alliance.tag,
              name: data.alliance.name ?? data.alliance.tag,
            })
          : t("allianceSavedGeneric"),
      );
      router.refresh();
    } catch {
      setMessage(t("allianceSaveFailed"));
    } finally {
      setAllianceSaving(false);
    }
  }

  async function saveReminderDays(days: number) {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/connection", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiryReminderDays: days }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setMessage(data.error ?? t("reminderSaveFailed"));
        return;
      }
      const data = (await res.json()) as { ashed: AshedConnectionMeta };
      setAshed(data.ashed);
      setReminderDays(data.ashed.expiryReminderDays);
      setMessage(t("reminderSaved"));
    } catch {
      setMessage(t("reminderSaveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/disconnect", { method: "POST" });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setMessage(data.error ?? tc("disconnectFailed"));
        return;
      }
      router.push("/connect");
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : tc("disconnectFailed"));
    } finally {
      setDisconnecting(false);
    }
  }

  const canSaveAlliance =
    !!selectedAllianceId &&
    (accessibleAlliances.length === 1 ||
      selectedAllianceId !== initialAllianceId);

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-[#8b949e]">{t("subtitle")}</p>
      </div>

      <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
        <h2 className="font-medium">{t("allianceSection")}</h2>
        <p className="mt-2 text-sm text-[#8b949e]">{t("allianceBody")}</p>
        <div className="mt-4">
          <AlliancePicker
            alliances={accessibleAlliances}
            selectedAllianceId={selectedAllianceId}
            onSelect={setSelectedAllianceId}
            label={t("alliancePickerLabel")}
            hint={t("alliancePickerHint")}
            emptyMessage={alliancesError ?? t("allianceNone")}
            loading={alliancesLoading}
            loadingMessage={t("allianceLoading")}
          />
        </div>
        <button
          type="button"
          onClick={() => void saveAlliance()}
          disabled={allianceSaving || !canSaveAlliance || alliancesLoading}
          className="mt-4 rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {allianceSaving ? t("allianceSaving") : t("allianceSave")}
        </button>
      </section>

      <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
        <h2 className="font-medium">{t("tokenSection")}</h2>
        {ashed?.tokenExpiresAtFormatted ? (
          <div className="mt-3 space-y-4">
            <TokenExpiryNotice
              formattedDate={ashed.tokenExpiresAtFormatted}
              reminderDays={reminderDays}
            />
            <label className="block text-sm">
              <span className="mb-2 block text-[#8b949e]">{t("remindMe")}</span>
              <select
                value={reminderDays}
                onChange={(e) => {
                  const days = Number(e.target.value);
                  setReminderDays(days);
                  void saveReminderDays(days);
                }}
                disabled={saving}
                className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
              >
                {REMINDER_OPTIONS.map((days) => (
                  <option key={days} value={days}>
                    {t("reminderOption", { days })}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <p className="mt-2 text-sm text-[#8b949e]">{t("reconnectHint")}</p>
        )}
      </section>

      <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
        <h2 className="font-medium">{t("disconnectSection")}</h2>
        <p className="mt-2 text-sm text-[#8b949e]">{t("disconnectBody")}</p>
        <p className="mt-2 text-sm text-[#8b949e]">{tToken("logoutWarning")}</p>
        <button
          type="button"
          onClick={() => void disconnect()}
          disabled={disconnecting}
          className="mt-4 rounded-lg border border-[#f85149] px-4 py-2 text-sm text-[#f85149] hover:bg-[#f8514920] disabled:opacity-50"
        >
          {disconnecting ? t("disconnecting") : t("disconnectButton")}
        </button>
      </section>

      {message && (
        <p
          className={`text-sm ${
            message === t("reminderSaved") ||
            message === t("allianceSavedGeneric") ||
            message.includes("Linked to")
              ? "text-[#3fb950]"
              : "text-[#f85149]"
          }`}
        >
          {message}
        </p>
      )}

      <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5 text-sm text-[#8b949e]">
        <p>
          {t.rich("aboutBody", {
            strong: strongText,
            link: ashedLink,
          })}
        </p>
      </section>
    </div>
  );
}
