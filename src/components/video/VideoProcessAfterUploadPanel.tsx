"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Link, useRouter } from "@/i18n/navigation";
import { AppSelect } from "@/components/ui/AppSelect";
import type { VideoProcessPreview } from "@/lib/video/video-process-preview.shared";

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

type Props = {
  jobId: string;
  ashedConnected: boolean;
  connectUrl: string;
  onDismiss: () => void;
};

export function VideoProcessAfterUploadPanel({
  jobId,
  ashedConnected,
  connectUrl,
  onDismiss,
}: Props) {
  const t = useTranslations("video.processAfterUpload");
  const tQueue = useTranslations("videoQueue");
  const tNav = useTranslations("nav");
  const tVideo = useTranslations("video");
  const router = useRouter();

  const [preview, setPreview] = useState<VideoProcessPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [ocrSettingsBusy, setOcrSettingsBusy] = useState(false);
  const previewExperimentKey = useMemo(() => {
    if (!preview?.experiment) return "";
    return `${preview.experiment.campaignId}:${preview.experiment.armId}`;
  }, [preview]);
  const [experimentSelectionOverride, setExperimentSelectionOverride] =
    useState<string | null>(null);
  const selectedExperimentKey =
    experimentSelectionOverride ?? previewExperimentKey;

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tools/video-upload/${jobId}/process-preview`);
      const data = (await res.json()) as VideoProcessPreview & { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? t("loadFailed"));
      }
      setPreview(data);
      setExperimentSelectionOverride(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [jobId, t]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setError(null);
      try {
        const res = await fetch(`/api/tools/video-upload/${jobId}/process-preview`);
        const data = (await res.json()) as VideoProcessPreview & { error?: string };
        if (!res.ok) {
          throw new Error(data.error ?? t("loadFailed"));
        }
        if (!cancelled) {
          setPreview(data);
          setExperimentSelectionOverride(null);
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
  }, [jobId, t]);

  const experimentOptions = useMemo(() => {
    if (!preview) return [];
    const seen = new Set<string>();
    const rows: Array<{ value: string; label: string }> = [
      { value: "", label: t("experimentNone") },
    ];
    for (const option of preview.experimentOptions) {
      const value = `${option.campaignId}:${option.armId}`;
      if (seen.has(value)) continue;
      seen.add(value);
      const controlSuffix = option.isControl ? ` (${t("experimentControl")})` : "";
      rows.push({
        value,
        label: `${option.campaignName} — ${option.armName}${controlSuffix}`,
      });
    }
    return rows;
  }, [preview, t]);

  async function toggleHqOcrOnly(next: boolean) {
    if (!preview) return;
    setOcrSettingsBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tools/video-upload/queue/ocr-settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hqOcrOnly: next }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? tQueue("ocrSettingsSaveFailed"));
      }
      await loadPreview();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : tQueue("ocrSettingsSaveFailed"),
      );
    } finally {
      setOcrSettingsBusy(false);
    }
  }

  async function saveExperimentSelection(nextKey: string) {
    if (!preview) return;
    setExperimentSelectionOverride(nextKey);
    setActing(true);
    setError(null);
    try {
      let campaignId: string | null = null;
      let armId: string | null = null;
      if (nextKey) {
        const [campaign, arm] = nextKey.split(":");
        campaignId = campaign ?? null;
        armId = arm ?? null;
      }
      const res = await fetch(`/api/tools/video-upload/${jobId}/experiment`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignId, armId }),
      });
      const data = (await res.json()) as VideoProcessPreview & { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? t("experimentSaveFailed"));
      }
      setPreview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("experimentSaveFailed"));
      await loadPreview();
    } finally {
      setActing(false);
    }
  }

  async function processNow() {
    setActing(true);
    setError(null);
    try {
      const res = await fetch(`/api/tools/video-upload/${jobId}/approve`, {
        method: "POST",
      });
      const data = (await res.json()) as { error?: string; code?: string };
      if (!res.ok) {
        if (data.code === "ashed_not_connected") {
          router.push(connectUrl);
          return;
        }
        throw new Error(data.error ?? tQueue("approveFailed"));
      }
      router.push(`/tools/video-upload/${jobId}/review`);
    } catch (err) {
      setError(err instanceof Error ? err.message : tQueue("approveFailed"));
    } finally {
      setActing(false);
    }
  }

  function engineLabel(engine: VideoProcessPreview["primaryEngine"]): string {
    if (engine === "ashed") return t("engineAshed");
    if (engine === "native") return t("engineNative");
    return t("engineMock");
  }

  function shadowLabel(kind: VideoProcessPreview["shadowFollowups"][number]["kind"]): string {
    if (kind === "extraction_shadow") return t("shadowExtraction");
    return t("shadowTesseract");
  }

  if (loading && !preview) {
    return (
      <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-4 sm:p-5">
        <p className="text-sm text-[#8b949e]">{t("loading")}</p>
      </section>
    );
  }

  if (!preview) {
    return (
      <section className="rounded-xl border border-[#f85149] bg-[#161b22] p-4 sm:p-5">
        <p className="text-sm text-[#f85149]">{error ?? t("loadFailed")}</p>
      </section>
    );
  }

  const needsConnect = preview.requiresAshedConnection && !ashedConnected;
  const scoreTargetLabel = preview.scoreTarget ?? "—";
  const boardLabel =
    preview.boardKey && preview.boardKey in { kills: 1, resources: 1, points: 1 }
      ? tVideo(`boardTypes.${preview.boardKey as "kills"}`)
      : preview.boardKey;

  return (
    <section className="rounded-xl border border-[#3fb950] bg-[#161b22] p-4 sm:p-5">
      <h2 className="text-lg font-semibold text-[#e6edf3]">{t("title")}</h2>
      <p className="mt-1 text-sm text-[#8b949e]">{t("subtitle")}</p>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-[#8b949e]">{t("statFile")}</dt>
          <dd className="mt-0.5 break-all font-medium text-[#e6edf3]">
            {preview.fileName ?? preview.jobId}
          </dd>
        </div>
        <div>
          <dt className="text-[#8b949e]">{t("statSize")}</dt>
          <dd className="mt-0.5 font-medium text-[#e6edf3]">
            {formatBytes(preview.fileSizeBytes)}
          </dd>
        </div>
        <div>
          <dt className="text-[#8b949e]">{t("statTarget")}</dt>
          <dd className="mt-0.5 font-medium text-[#e6edf3]">{scoreTargetLabel}</dd>
        </div>
        {boardLabel ? (
          <div>
            <dt className="text-[#8b949e]">{t("statBoard")}</dt>
            <dd className="mt-0.5 font-medium text-[#e6edf3]">{boardLabel}</dd>
          </div>
        ) : null}
        {preview.passKey ? (
          <div>
            <dt className="text-[#8b949e]">{t("statPass")}</dt>
            <dd className="mt-0.5 font-medium text-[#e6edf3]">{preview.passKey}</dd>
          </div>
        ) : null}
      </dl>

      <div className="mt-4 space-y-2">
        <h3 className="text-sm font-medium text-[#e6edf3]">{t("enginesTitle")}</h3>
        <ul className="space-y-1 text-sm text-[#c9d1d9]">
          <li>
            <span className="text-[#8b949e]">{t("primaryEngineLabel")}: </span>
            {engineLabel(preview.primaryEngine)}
          </li>
          {preview.shadowFollowups.length === 0 ? (
            <li className="text-[#8b949e]">{t("noShadowFollowups")}</li>
          ) : (
            preview.shadowFollowups.map((shadow) => (
              <li key={shadow.kind}>
                <span className="text-[#8b949e]">{t("followupEngineLabel")}: </span>
                {shadowLabel(shadow.kind)}
                {shadow.conditional ? (
                  <span className="text-[#8b949e]"> — {t("shadowConditional")}</span>
                ) : null}
              </li>
            ))
          )}
        </ul>
      </div>

      {preview.canProcess ? (
        <div className="mt-4 space-y-3 rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
          <h3 className="text-sm font-medium text-[#e6edf3]">
            {tQueue("ocrSettingsTitle")}
          </h3>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={preview.hqOcrOnly}
              disabled={ocrSettingsBusy || acting}
              onChange={(e) => void toggleHqOcrOnly(e.target.checked)}
            />
            <span className="min-w-0 text-sm text-[#e6edf3]">
              {tQueue("hqOcrOnlyLabel")}
            </span>
          </label>
        </div>
      ) : null}

      {preview.canProcess && experimentOptions.length > 1 ? (
        <label className="mt-4 block">
          <span className="mb-2 block text-sm text-[#8b949e]">
            {t("experimentLabel")}
          </span>
          <AppSelect
            value={selectedExperimentKey}
            onChange={(value) => void saveExperimentSelection(value)}
            aria-label={t("experimentLabel")}
            options={experimentOptions}
            disabled={acting}
          />
          <p className="mt-2 text-xs text-[#8b949e]">{t("experimentHint")}</p>
        </label>
      ) : preview.experiment ? (
        <p className="mt-4 text-sm text-[#c9d1d9]">
          <span className="text-[#8b949e]">{t("experimentActive")}: </span>
          {preview.experiment.campaignName} — {preview.experiment.armName}
        </p>
      ) : null}

      {needsConnect ? (
        <p className="mt-4 text-sm text-[#d29922]">{tQueue("connectBanner")}</p>
      ) : null}

      {error ? <p className="mt-4 text-sm text-[#f85149]">{error}</p> : null}

      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {needsConnect ? (
          <button
            type="button"
            onClick={() => router.push(connectUrl)}
            className="rounded-lg border border-[#d29922] px-4 py-2 text-sm font-medium text-[#d29922] hover:bg-[#d2992220]"
          >
            {tQueue("connectCta")}
          </button>
        ) : (
          <button
            type="button"
            disabled={acting || !preview.canProcess}
            onClick={() => void processNow()}
            className="rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {acting ? t("processing") : t("processNow")}
          </button>
        )}
        <button
          type="button"
          disabled={acting}
          onClick={onDismiss}
          className="rounded-lg border border-[#30363d] px-4 py-2 text-sm text-[#8b949e] hover:border-[#58a6ff] hover:text-[#58a6ff] disabled:opacity-50"
        >
          {t("later")}
        </button>
        <Link
          href="/tools/video-upload/queue"
          className="rounded-lg border border-[#30363d] px-4 py-2 text-center text-sm text-[#58a6ff] hover:underline"
        >
          {tNav("videoQueue")} →
        </Link>
      </div>
    </section>
  );
}
