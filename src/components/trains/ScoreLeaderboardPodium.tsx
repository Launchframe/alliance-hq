"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import {
  ConductorWheelSharePreviewDialog,
  type ConductorWheelSharePreview,
} from "@/components/trains/ConductorWheelSharePreviewDialog";
import { ScoreLeaderboardDisplay } from "@/components/trains/ScoreLeaderboardDisplay";
import { renderScoreLeaderboardSharePngBlob } from "@/lib/client/score-leaderboard-share-image.client";
import { formatTrainPointCount } from "@/lib/trains/train-conductor-minimums.shared";
import {
  SCORE_LEADERBOARD_LIST_MAX,
  type ScoreLeaderboardEntry,
  type ScoreLeaderboardKind,
  type ScoreLeaderboardPayload,
} from "@/lib/trains/score-leaderboard-podium.shared";

type Props = {
  trainDate: string;
  kind: ScoreLeaderboardKind;
};

/** Sub-namespace under `trains.scoreLeaderboard` holding this kind's title/subtitle/aria copy. */
function copyKeyForKind(
  kind: ScoreLeaderboardKind,
): "tpif" | "vsPush" | "vrPush" {
  if (kind === "vs_push") return "vsPush";
  if (kind === "vr_push") return "vrPush";
  return "tpif";
}

function formatScoreDay(scoreDate: string, locale: string): string {
  return new Date(`${scoreDate}T12:00:00`).toLocaleDateString(locale, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export function ScoreLeaderboardPodium({ trainDate, kind }: Props) {
  const t = useTranslations("trains.scoreLeaderboard");
  const tWheel = useTranslations("trains.wheel");
  const locale = useLocale();
  const [payload, setPayload] = useState<ScoreLeaderboardPayload | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [sharePreview, setSharePreview] =
    useState<ConductorWheelSharePreview | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/trains/score-leaderboard?date=${encodeURIComponent(trainDate)}&kind=${encodeURIComponent(kind)}`,
        );
        const body = (await res.json()) as ScoreLeaderboardPayload & {
          error?: string;
        };
        if (!res.ok) {
          if (!cancelled) {
            setError(body.error ?? t("loadFailed"));
            setPayload(null);
          }
          return;
        }
        if (!cancelled) setPayload(body);
      } catch {
        if (!cancelled) {
          setError(t("loadFailed"));
          setPayload(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, t, trainDate]);

  useEffect(() => {
    return () => {
      setSharePreview((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return null;
      });
    };
  }, []);

  if (loading) {
    return (
      <section
        className="overflow-hidden rounded-xl border border-hq-accent/30 bg-gradient-to-b from-hq-accent/10 to-hq-surface p-5"
        data-testid="score-leaderboard-podium"
      >
        <p className="text-sm text-hq-fg-muted">{t("loading")}</p>
      </section>
    );
  }

  if (error) {
    return (
      <section
        className="overflow-hidden rounded-xl border border-hq-accent/30 bg-gradient-to-b from-hq-accent/10 to-hq-surface p-5"
        data-testid="score-leaderboard-podium"
      >
        <p className="text-sm text-hq-danger">{error}</p>
      </section>
    );
  }

  if (!payload) return null;

  if (payload.unavailable) {
    return (
      <section
        className="overflow-hidden rounded-xl border border-hq-border bg-hq-surface p-5"
        data-testid="score-leaderboard-podium"
      >
        <h3 className="text-base font-semibold text-hq-fg">
          {t("donations.unavailableTitle")}
        </h3>
        <p className="mt-1 text-sm text-hq-fg-muted">
          {t("donations.unavailableBody")}
        </p>
      </section>
    );
  }

  const copyKey = copyKeyForKind(kind);
  const podiumByRank = new Map(
    payload.podium.map((entry) => [entry.rank, entry] as const),
  );
  const shareEntries = payload.entries.slice(0, SCORE_LEADERBOARD_LIST_MAX);
  const dayLabel = payload.scoreDate
    ? formatScoreDay(payload.scoreDate, locale)
    : trainDate;

  const toDisplayEntry = (entry: ScoreLeaderboardEntry) => ({
    rank: entry.rank,
    memberId: entry.memberId,
    memberName: entry.memberName,
    label: t("podium.rankScore", {
      rank: entry.rank,
      score: formatTrainPointCount(entry.score, locale),
    }),
    isViewer: entry.isViewer,
  });

  const handleShare = async () => {
    if (shareBusy || shareEntries.length === 0) return;
    setShareBusy(true);
    setShareError(null);
    try {
      const blob = await renderScoreLeaderboardSharePngBlob({
        title: t(`${copyKey}.title`),
        subtitle: t("share.subtitle", { day: dayLabel }),
        entries: shareEntries,
        locale,
      });
      const safeDate =
        dayLabel.replace(/[^\w-]+/g, "-").toLowerCase() || "leaderboard";
      const filename = `score-leaderboard-${safeDate}.png`;
      const url = URL.createObjectURL(blob);
      setSharePreview((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return { blob, url, filename };
      });
    } catch {
      setShareError(t("share.failed"));
    } finally {
      setShareBusy(false);
    }
  };

  return (
    <>
      <ScoreLeaderboardDisplay
        title={t(`${copyKey}.title`)}
        subtitle={t(`${copyKey}.subtitle`, {
          day: payload.scoreDate ? formatScoreDay(payload.scoreDate, locale) : "",
        })}
        podium={[1, 2, 3].map((rank) => {
          const entry = podiumByRank.get(rank);
          return entry ? toDisplayEntry(entry) : undefined;
        })}
        remaining={payload.entries
          .slice(3, SCORE_LEADERBOARD_LIST_MAX)
          .map(toDisplayEntry)}
        podiumAria={t(`${copyKey}.podiumAria`)}
        emptySlotLabel={t("podium.empty")}
        headerAction={
          shareEntries.length > 0 ? (
            <button
              type="button"
              disabled={shareBusy}
              onClick={() => void handleShare()}
              data-testid="score-leaderboard-share"
              className="inline-flex shrink-0 items-center justify-center rounded-lg border border-[#8957e5]/50 bg-[#8957e5]/10 px-3 py-1.5 text-sm font-medium text-[#8250df] hover:bg-[#8957e5]/20 disabled:opacity-50 dark:text-[#d2a8ff]"
            >
              {shareBusy ? tWheel("share.exporting") : t("share.action")}
            </button>
          ) : null
        }
        notices={
          shareError ? (
            <p className="mt-2 text-sm text-hq-danger" role="alert">
              {shareError}
            </p>
          ) : null
        }
      />
      <ConductorWheelSharePreviewDialog
        open={sharePreview != null}
        preview={sharePreview}
        onClose={() => {
          setSharePreview((prev) => {
            if (prev) URL.revokeObjectURL(prev.url);
            return null;
          });
        }}
      />
    </>
  );
}
