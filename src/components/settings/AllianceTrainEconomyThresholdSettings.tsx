"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { PriceIsRightTicketDistributionChart } from "@/components/trains/PriceIsRightTicketDistributionChart";
import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";
import { allianceTrainEconomyThresholdApiPath } from "@/lib/alliance/alliance-settings-path.shared";
import {
  PRICE_IS_RIGHT_DEFAULT_CLIFF_POINTS,
  type PriceIsRightTicketSettings,
} from "@/lib/trains/train-price-is-right-tickets.shared";

export type TrainEconomyThresholdPayload = {
  thresholdPoints: number | null;
  fudgePct: number;
  weightingEnabled: boolean;
  hardCutoffEnabled: boolean;
  maxTicketMemberIds: string[];
  effectiveCliffPoints: number | null;
  canManage: boolean;
};

type RosterMember = {
  ashedMemberId: string;
  currentName: string;
};

type Props = {
  allianceTag: string;
};

export function AllianceTrainEconomyThresholdSettings({ allianceTag }: Props) {
  const t = useTranslations("settings.trainEconomyThreshold");
  const [settings, setSettings] = useState<TrainEconomyThresholdPayload | null>(
    null,
  );
  const [thresholdPoints, setThresholdPoints] = useState("");
  const [fudgePct, setFudgePct] = useState("1");
  const [weightingEnabled, setWeightingEnabled] = useState(false);
  const [hardCutoffEnabled, setHardCutoffEnabled] = useState(false);
  const [maxTicketMemberIds, setMaxTicketMemberIds] = useState<string[]>([]);
  const [takedownQuery, setTakedownQuery] = useState("");
  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadedTag, setLoadedTag] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loading = loadedTag !== allianceTag;
  const displaySettings = loadedTag === allianceTag ? settings : null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(allianceTrainEconomyThresholdApiPath(allianceTag));
        const body = (await res.json()) as TrainEconomyThresholdPayload & {
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
          setSettings(body);
          setThresholdPoints(
            body.thresholdPoints != null
              ? String(body.thresholdPoints)
              : body.weightingEnabled
                ? String(PRICE_IS_RIGHT_DEFAULT_CLIFF_POINTS)
                : "",
          );
          setFudgePct(String(body.fudgePct));
          setWeightingEnabled(body.weightingEnabled);
          setHardCutoffEnabled(body.hardCutoffEnabled);
          setMaxTicketMemberIds(body.maxTicketMemberIds ?? []);
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

  useEffect(() => {
    if (!displaySettings?.canManage) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/members");
        if (!res.ok) return;
        const body = (await res.json()) as {
          members?: Array<{ id: string; current_name: string }>;
        };
        if (!cancelled) {
          setRoster(
            (body.members ?? []).map((member) => ({
              ashedMemberId: member.id,
              currentName: member.current_name,
            })),
          );
        }
      } catch {
        // Optional roster for takedown picker.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [displaySettings?.canManage]);

  const parseOptionalThreshold = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const n = Number.parseInt(trimmed, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const previewSettings = useMemo<PriceIsRightTicketSettings>(
    () => ({
      weightingEnabled,
      cliffPoints: parseOptionalThreshold(thresholdPoints),
      hardCutoffEnabled,
      maxTicketMemberIds,
    }),
    [hardCutoffEnabled, maxTicketMemberIds, thresholdPoints, weightingEnabled],
  );

  const previewEconomy = useMemo(
    () => ({
      thresholdPoints: parseOptionalThreshold(thresholdPoints),
      fudgePct: (() => {
        const fudge = Number.parseInt(fudgePct, 10);
        return Number.isFinite(fudge) ? Math.min(100, Math.max(0, fudge)) : 1;
      })(),
    }),
    [fudgePct, thresholdPoints],
  );

  const chartCaption = weightingEnabled
    ? t("chartCaption")
    : previewEconomy.thresholdPoints != null
      ? t("chartCaptionUniform")
      : t("chartCaptionNoFilter");

  const filteredRoster = useMemo(() => {
    const q = takedownQuery.trim().toLowerCase();
    const selected = new Set(maxTicketMemberIds);
    return roster.filter((member) => {
      if (selected.has(member.ashedMemberId)) return false;
      if (!q) return true;
      return member.currentName.toLowerCase().includes(q);
    });
  }, [maxTicketMemberIds, roster, takedownQuery]);

  const selectedMembers = useMemo(
    () =>
      maxTicketMemberIds.flatMap((memberId) => {
        const member = roster.find((row) => row.ashedMemberId === memberId);
        return member ? [member] : [];
      }),
    [maxTicketMemberIds, roster],
  );

  const toggleTakedownMember = (memberId: string) => {
    setMaxTicketMemberIds((current) =>
      current.includes(memberId)
        ? current.filter((id) => id !== memberId)
        : [...current, memberId],
    );
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const fudge = Number.parseInt(fudgePct, 10);
      const res = await fetch(allianceTrainEconomyThresholdApiPath(allianceTag), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thresholdPoints: parseOptionalThreshold(thresholdPoints),
          fudgePct: Number.isFinite(fudge) ? fudge : 1,
          weightingEnabled,
          hardCutoffEnabled,
          maxTicketMemberIds,
        }),
      });
      const body = (await res.json()) as TrainEconomyThresholdPayload & {
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? t("saveFailed"));
        return;
      }
      setSettings(body);
      setThresholdPoints(
        body.thresholdPoints != null
          ? String(body.thresholdPoints)
          : body.weightingEnabled
            ? String(PRICE_IS_RIGHT_DEFAULT_CLIFF_POINTS)
            : "",
      );
      setFudgePct(String(body.fudgePct));
      setWeightingEnabled(body.weightingEnabled);
      setHardCutoffEnabled(body.hardCutoffEnabled);
      setMaxTicketMemberIds(body.maxTicketMemberIds ?? []);
    } catch {
      setError(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <section
        id="price-is-freight"
        className="scroll-mt-6 rounded-xl border border-hq-border bg-hq-surface p-5"
      >
        <p className="text-sm text-hq-fg-muted">{t("loading")}</p>
      </section>
    );
  }

  if (!displaySettings) {
    return error ? (
      <section
        id="price-is-freight"
        className="scroll-mt-6 rounded-xl border border-hq-border bg-hq-surface p-5"
      >
        <p className="text-sm text-hq-danger">{error}</p>
      </section>
    ) : null;
  }

  return (
    <section
      id="price-is-freight"
      className="scroll-mt-6 rounded-xl border border-hq-border bg-hq-surface p-5"
    >
      <h2 className="text-base font-semibold text-hq-fg">{t("sectionTitle")}</h2>
      <p className="mt-1 text-sm text-hq-fg-muted">
        {weightingEnabled ? t("sectionBodyWeighting") : t("sectionBody")}
      </p>

      <form
        onSubmit={(event) => {
          preventDefaultFormSubmit(event);
          void save();
        }}
      >
        <label className="mt-4 flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={weightingEnabled}
            onChange={(event) => setWeightingEnabled(event.target.checked)}
            disabled={!displaySettings.canManage || busy}
            className="mt-1"
          />
          <span>
            <span className="font-medium text-hq-fg">{t("weightingLabel")}</span>
            <span className="mt-0.5 block text-hq-fg-muted">{t("weightingHint")}</span>
          </span>
        </label>

        <div
          className={`mt-4 grid gap-4 ${
            weightingEnabled ? "grid-cols-1" : "sm:grid-cols-2"
          }`}
        >
          <label className="block text-sm">
            <span className="text-hq-fg-muted">
              {weightingEnabled ? t("cliffLabel") : t("thresholdLabel")}
            </span>
            <input
              type="number"
              min={0}
              step={1}
              value={thresholdPoints}
              onChange={(e) => setThresholdPoints(e.target.value)}
              disabled={!displaySettings.canManage || busy}
              placeholder={
                weightingEnabled
                  ? t("cliffPlaceholder")
                  : t("thresholdPlaceholder")
              }
              className="mt-1 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-hq-fg disabled:opacity-60"
            />
            {weightingEnabled ? (
              <span className="mt-1 block text-xs text-hq-fg-muted">
                {t("cliffHint")}
              </span>
            ) : null}
          </label>

          {!weightingEnabled ? (
            <label className="block text-sm">
              <span className="text-hq-fg-muted">{t("fudgeLabel")}</span>
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={fudgePct}
                onChange={(e) => setFudgePct(e.target.value)}
                enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
                disabled={!displaySettings.canManage || busy}
                className="mt-1 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-hq-fg disabled:opacity-60"
              />
              <span className="mt-1 block text-xs text-hq-fg-muted">
                {t("fudgeHint")}
              </span>
            </label>
          ) : null}
        </div>

        {weightingEnabled ? (
          <label className="mt-4 flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={hardCutoffEnabled}
              onChange={(event) => setHardCutoffEnabled(event.target.checked)}
              disabled={!displaySettings.canManage || busy}
              className="mt-1"
            />
            <span>
              <span className="font-medium text-hq-fg">{t("hardCutoffLabel")}</span>
              <span className="mt-0.5 block text-hq-fg-muted">
                {t("hardCutoffHint")}
              </span>
            </span>
          </label>
        ) : null}

        <div className="mt-4">
          <p className="text-sm font-medium text-hq-fg">{t("takedownLabel")}</p>
          <p className="mt-0.5 text-xs text-hq-fg-muted">{t("takedownHint")}</p>
          {selectedMembers.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-2">
              {selectedMembers.map((member) => (
                <li key={member.ashedMemberId}>
                  <button
                    type="button"
                    onClick={() => toggleTakedownMember(member.ashedMemberId)}
                    disabled={!displaySettings.canManage || busy}
                    className="rounded-full border border-violet-500/40 bg-violet-500/15 px-3 py-1 text-xs font-medium text-violet-100 hover:bg-violet-500/25 disabled:opacity-60"
                  >
                    {member.currentName} ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {displaySettings.canManage ? (
            <>
              <input
                type="search"
                value={takedownQuery}
                onChange={(event) => setTakedownQuery(event.target.value)}
                placeholder={t("takedownSearchPlaceholder")}
                disabled={busy}
                className="mt-3 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg disabled:opacity-60"
              />
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-hq-border bg-hq-canvas/60 p-2">
                {filteredRoster.length === 0 ? (
                  <li className="px-2 py-1 text-xs text-hq-fg-muted">
                    {t("takedownEmpty")}
                  </li>
                ) : (
                  filteredRoster.slice(0, 12).map((member) => (
                    <li key={member.ashedMemberId}>
                      <button
                        type="button"
                        onClick={() => toggleTakedownMember(member.ashedMemberId)}
                        disabled={busy}
                        className="w-full rounded-md px-2 py-1.5 text-left text-sm text-hq-fg hover:bg-hq-surface"
                      >
                        {member.currentName}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </>
          ) : null}
        </div>

        <PriceIsRightTicketDistributionChart
          key={weightingEnabled ? "weighted" : "uniform"}
          className="mt-5"
          settings={previewSettings}
          economy={previewEconomy}
          caption={chartCaption}
          data-testid="price-is-right-settings-chart"
        />

        {error ? <p className="mt-3 text-sm text-hq-danger">{error}</p> : null}

        {displaySettings.canManage ? (
          <div className="mt-4">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-hq-success px-4 py-2 text-sm font-medium text-white hover:bg-hq-success-hover disabled:opacity-60"
            >
              {busy ? t("saving") : t("save")}
            </button>
          </div>
        ) : (
          <p className="mt-4 text-xs text-hq-fg-muted">{t("officersOnly")}</p>
        )}
      </form>
    </section>
  );
}
