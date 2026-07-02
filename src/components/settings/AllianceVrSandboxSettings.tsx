"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { allianceVrSandboxApiPath } from "@/lib/alliance/alliance-settings-path.shared";

type Props = {
  allianceTag: string;
};

type Payload = {
  enabled: boolean;
  seasonKey: string | null;
  canManage: boolean;
  error?: string;
};

export function AllianceVrSandboxSettings({ allianceTag }: Props) {
  const t = useTranslations("settings.vrSandbox");
  const [settings, setSettings] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadedTag, setLoadedTag] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const loading = loadedTag !== allianceTag;
  const display = loadedTag === allianceTag ? settings : null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(allianceVrSandboxApiPath(allianceTag));
        const body = (await res.json()) as Payload;
        if (!res.ok) {
          if (!cancelled) {
            setError(body.error ?? t("loadFailed"));
            setLoadedTag(allianceTag);
          }
          return;
        }
        if (!cancelled) {
          setSettings(body);
          setError(null);
          setLoadedTag(allianceTag);
        }
      } catch {
        if (!cancelled) {
          setError(t("loadFailed"));
          setLoadedTag(allianceTag);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allianceTag, t]);

  const applyEnabled = async (next: boolean) => {
    if (!display?.canManage) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(allianceVrSandboxApiPath(allianceTag), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const body = (await res.json()) as Payload;
      if (!res.ok) {
        setError(body.error ?? t("saveFailed"));
        return;
      }
      setSettings(body);
      setConfirmDisable(false);
    } catch {
      setError(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const onToggle = (next: boolean) => {
    if (!display?.canManage || busy) return;
    if (!next && display.enabled) {
      setConfirmDisable(true);
      return;
    }
    void applyEnabled(next);
  };

  return (
    <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-4">
      <h2 className="text-lg font-semibold text-[#e6edf3]">{t("title")}</h2>
      <p className="mt-1 text-sm text-[#8b949e]">{t("description")}</p>

      {loading ? (
        <p className="mt-4 text-sm text-[#8b949e]">{t("loading")}</p>
      ) : error ? (
        <p className="mt-4 text-sm text-[#f85149]">{error}</p>
      ) : display ? (
        <div className="mt-4 space-y-3">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={display.enabled}
              disabled={!display.canManage || busy}
              onChange={(e) => onToggle(e.target.checked)}
            />
            <span className="min-w-0 text-sm text-[#e6edf3]">
              {t("enabledLabel")}
            </span>
          </label>
          {display.enabled ? (
            <p className="text-sm text-[#d29922]">{t("activeNotice")}</p>
          ) : null}
          {!display.canManage ? (
            <p className="text-xs text-[#8b949e]">{t("readOnlyHint")}</p>
          ) : null}
          {confirmDisable ? (
            <div className="rounded-lg border border-[#f85149]/40 bg-[#0d1117] p-3">
              <p className="text-sm text-[#e6edf3]">{t("disableConfirmBody")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void applyEnabled(false)}
                  className="rounded-lg border border-[#f85149] px-3 py-1.5 text-sm text-[#f85149] hover:bg-[#f8514920] disabled:opacity-50"
                >
                  {t("disableConfirmAction")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmDisable(false)}
                  className="rounded-lg border border-[#30363d] px-3 py-1.5 text-sm text-[#8b949e] hover:text-[#e6edf3] disabled:opacity-50"
                >
                  {t("disableCancel")}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
