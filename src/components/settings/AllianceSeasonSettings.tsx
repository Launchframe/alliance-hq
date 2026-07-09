"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { allianceSeasonApiPath } from "@/lib/alliance/alliance-settings-path.shared";
import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";

export type AllianceSeasonPayload = {
  seasonKey: string;
  source: string;
  isPostSeason: boolean;
  week: number | null;
  gameServerNumber: number | null;
  seasonKeyOverride: string | null;
  canManageSeason: boolean;
  canEditGameServer: boolean;
  hasLinkedGameServer: boolean;
};

type Props = {
  allianceTag: string;
};

export function AllianceSeasonSettings({ allianceTag }: Props) {
  const t = useTranslations("settings.gameSeason");
  const [season, setSeason] = useState<AllianceSeasonPayload | null>(null);
  const [draft, setDraft] = useState("");
  const [serverDraft, setServerDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadedTag, setLoadedTag] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loading = loadedTag !== allianceTag;
  const displaySeason = loadedTag === allianceTag ? season : null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(allianceSeasonApiPath(allianceTag));
        const body = (await res.json()) as AllianceSeasonPayload & {
          error?: string;
        };
        if (!res.ok) {
          if (!cancelled) {
            setError(body.error ?? t("loadFailed"));
            setLoadedTag(allianceTag);
          }
          return;
        }
        if (!cancelled) {
          setSeason(body);
          setDraft(body.seasonKeyOverride ?? "");
          setServerDraft(
            body.gameServerNumber != null ? String(body.gameServerNumber) : "",
          );
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

  const saveOverride = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(allianceSeasonApiPath(allianceTag), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seasonKeyOverride: draft.trim() || null }),
      });
      const body = (await res.json()) as AllianceSeasonPayload & { error?: string };
      if (!res.ok) {
        setError(body.error ?? t("saveFailed"));
        return;
      }
      setSeason(body);
      setDraft(body.seasonKeyOverride ?? "");
    } catch {
      setError(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const resyncSeason = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(allianceSeasonApiPath(allianceTag), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resyncSeason: true }),
      });
      const body = (await res.json()) as AllianceSeasonPayload & { error?: string };
      if (!res.ok) {
        setError(body.error ?? t("resyncFailed"));
        return;
      }
      setSeason(body);
      setDraft(body.seasonKeyOverride ?? "");
    } catch {
      setError(t("resyncFailed"));
    } finally {
      setBusy(false);
    }
  };

  const saveServer = async () => {
    const parsed = Number.parseInt(serverDraft.trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError(t("serverNumberInvalid"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(allianceSeasonApiPath(allianceTag), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameServerNumber: parsed }),
      });
      const body = (await res.json()) as AllianceSeasonPayload & { error?: string };
      if (!res.ok) {
        setError(body.error ?? t("saveFailed"));
        return;
      }
      setSeason(body);
      setServerDraft(
        body.gameServerNumber != null ? String(body.gameServerNumber) : "",
      );
    } catch {
      setError(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const clearOverride = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(allianceSeasonApiPath(allianceTag), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seasonKeyOverride: null }),
      });
      const body = (await res.json()) as AllianceSeasonPayload & { error?: string };
      if (!res.ok) {
        setError(body.error ?? t("clearFailed"));
        return;
      }
      setSeason(body);
      setDraft(body.seasonKeyOverride ?? "");
    } catch {
      setError(t("clearFailed"));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
        <p className="text-sm text-hq-fg-muted">{t("loading")}</p>
      </section>
    );
  }

  if (!displaySeason) {
    return error ? (
      <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
        <p className="text-sm text-hq-danger">{error}</p>
      </section>
    ) : null;
  }

  const sourceLabel =
    displaySeason.source === "override"
      ? t("source.override")
      : displaySeason.source === "cpt-hedge"
        ? t("source.cpt-hedge")
        : displaySeason.source === "age-fallback"
          ? t("source.age-fallback")
          : t("source.default");
  const phaseLine =
    displaySeason.isPostSeason && displaySeason.week != null
      ? t("postSeasonWeek", { week: displaySeason.week })
      : displaySeason.week != null
        ? t("inSeasonWeek", { week: displaySeason.week })
        : null;
  const hasOverride = Boolean(displaySeason.seasonKeyOverride?.trim());
  const canResync =
    !hasOverride && displaySeason.gameServerNumber != null;

  return (
    <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
      <h2 className="font-medium">{t("sectionTitle")}</h2>
      <p className="mt-2 text-sm text-hq-fg-muted">{t("sectionBody")}</p>

      <div className="mt-4 space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-hq-fg-muted">
          {t("label")}
        </p>
        <p className="text-lg font-semibold text-hq-fg">
          {t("seasonLine", { season: displaySeason.seasonKey })}
        </p>
        <p className="text-sm text-hq-fg-muted">
          {sourceLabel}
          {displaySeason.gameServerNumber != null
            ? ` · ${t("serverLine", { server: displaySeason.gameServerNumber })}`
            : null}
        </p>
        {phaseLine ? (
          <p className="text-sm text-[#c9d1d9]">{phaseLine}</p>
        ) : null}
        {displaySeason.canEditGameServer &&
        displaySeason.gameServerNumber != null &&
        !displaySeason.hasLinkedGameServer ? (
          <p className="text-sm text-[#e3b341]">{t("serverLinkRequired")}</p>
        ) : null}
      </div>

      {displaySeason.canEditGameServer ? (
        <form
          className="mt-4 flex w-full min-w-0 max-w-md flex-col gap-2"
          onSubmit={(event) => {
            preventDefaultFormSubmit(event);
            void saveServer();
          }}
        >
          <label className="text-xs text-hq-fg-muted" htmlFor="settings-game-server">
            {t("serverNumberLabel")}
          </label>
          <input
            id="settings-game-server"
            type="text"
            inputMode="numeric"
            value={serverDraft}
            onChange={(e) => setServerDraft(e.target.value.replace(/\D/g, ""))}
            enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
            className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
          />
          <p className="text-xs text-hq-fg-subtle">
            {displaySeason.gameServerNumber == null
              ? t("serverNumberHint")
              : t("serverNumberUpdateHint")}
          </p>
          <button
            type="submit"
            disabled={busy || !serverDraft.trim()}
            className="w-fit rounded-lg bg-hq-success px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
          >
            {busy ? t("saving") : t("saveServer")}
          </button>
        </form>
      ) : null}

      {displaySeason.canManageSeason ? (
        <form
          className="mt-4 flex w-full min-w-0 max-w-md flex-col gap-2"
          onSubmit={(event) => {
            preventDefaultFormSubmit(event);
            void saveOverride();
          }}
        >
          <label className="text-xs text-hq-fg-muted" htmlFor="settings-season-override">
            {t("overrideLabel")}
          </label>
          {hasOverride ? (
            <p className="text-sm text-[#e3b341]" role="status">
              {t("overrideActive", { season: displaySeason.seasonKeyOverride! })}
            </p>
          ) : (
            <p className="text-sm text-hq-fg-muted" role="status">
              {t("autoSyncActive", { source: sourceLabel })}
            </p>
          )}
          <input
            id="settings-season-override"
            type="text"
            inputMode="numeric"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("overridePlaceholder")}
            enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
            className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
          />
          <p className="text-xs text-hq-fg-subtle">{t("overrideHint")}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="rounded-lg bg-hq-success px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
            >
              {busy ? t("saving") : t("saveOverride")}
            </button>
            {hasOverride ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void clearOverride()}
                className="rounded-lg border border-hq-border px-3 py-1.5 text-sm text-hq-fg disabled:opacity-60"
              >
                {t("clearOverride")}
              </button>
            ) : null}
            {canResync ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void resyncSeason()}
                className="rounded-lg border border-hq-border px-3 py-1.5 text-sm text-hq-fg disabled:opacity-60"
              >
                {t("resyncSeason")}
              </button>
            ) : null}
          </div>
        </form>
      ) : null}

      {error ? <p className="mt-2 text-sm text-hq-danger">{error}</p> : null}
    </section>
  );
}
