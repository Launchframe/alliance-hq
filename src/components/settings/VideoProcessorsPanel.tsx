"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import type { VideoProcessorEligibilityMode } from "@/lib/video/processor-slots.shared";

type Processor = {
  id: string;
  hqUserId: string;
  email: string;
  displayName: string | null;
};

type Candidate = {
  hqUserId: string;
  email: string;
  displayName: string | null;
  subtitle: string | null;
};

type Props = {
  initialProcessors: Processor[];
  initialCandidates: Candidate[];
  eligibilityMode: VideoProcessorEligibilityMode;
  max: number;
};

export function VideoProcessorsPanel({
  initialProcessors,
  initialCandidates,
  eligibilityMode,
  max,
}: Props) {
  const t = useTranslations("videoProcessors");
  const [processors, setProcessors] = useState<Processor[]>(initialProcessors);
  const [candidates, setCandidates] = useState<Candidate[]>(initialCandidates);
  const [mode, setMode] = useState(eligibilityMode);
  const [selected, setSelected] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const descriptionKey =
    mode === "native_r4_r5" ? "descriptionNative" : "descriptionAshed";
  const noCandidatesKey =
    mode === "native_r4_r5" ? "noCandidatesNative" : "noCandidatesAshed";

  const refresh = useCallback(async () => {
    const res = await fetch("/api/settings/video-processors");
    if (!res.ok) return;
    const data = (await res.json()) as {
      processors: Processor[];
      candidates: Candidate[];
      eligibilityMode: VideoProcessorEligibilityMode;
    };
    setProcessors(data.processors);
    setCandidates(data.candidates);
    setMode(data.eligibilityMode);
  }, []);

  async function add() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/video-processors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hqUserId: selected }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string; code?: string };
        throw new Error(
          data.code === "slots_full" ? t("slotsFull") : data.error ?? t("addFailed"),
        );
      }
      setSelected("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("addFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(hqUserId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/settings/video-processors?hqUserId=${encodeURIComponent(hqUserId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? t("removeFailed"));
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("removeFailed"));
    } finally {
      setBusy(false);
    }
  }

  const slotsFull = processors.length >= max;
  const name = (p: { displayName: string | null; email: string }) =>
    p.displayName ?? p.email;
  const optionLabel = (c: Candidate) =>
    c.subtitle ? `${name(c)} (${c.subtitle})` : name(c);

  return (
    <section className="space-y-3 rounded-xl border border-[#30363d] bg-[#161b22] p-4">
      <div>
        <h2 className="text-sm font-semibold text-[#e6edf3]">{t("title")}</h2>
        <p className="mt-1 text-xs text-[#8b949e]">{t(descriptionKey, { max })}</p>
        <p className="mt-2 text-xs text-[#8b949e]">
          {t("queueHint")}{" "}
          <Link
            href="/tools/video-upload/queue"
            className="text-[#58a6ff] hover:underline"
          >
            {t("queueLink")}
          </Link>
        </p>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      {processors.length === 0 ? (
        <p className="text-sm text-[#6e7681]">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {processors.map((p) => (
            <li
              key={p.hqUserId}
              className="flex items-center justify-between gap-3 rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
            >
              <span className="min-w-0 truncate text-sm text-[#e6edf3]">
                {name(p)}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void remove(p.hqUserId)}
                className="shrink-0 rounded-md border border-[#30363d] px-2.5 py-1 text-xs text-[#8b949e] hover:border-[#f85149] hover:text-[#f85149] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("remove")}
              </button>
            </li>
          ))}
        </ul>
      )}

      {slotsFull ? (
        <p className="text-xs text-[#d29922]">{t("slotsFull")}</p>
      ) : candidates.length === 0 ? (
        <p className="text-xs text-[#6e7681]">{t(noCandidatesKey)}</p>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-[#30363d] bg-[#0d1117] px-2 py-1.5 text-sm text-[#e6edf3]"
          >
            <option value="">{t("selectPlaceholder")}</option>
            {candidates.map((c) => (
              <option key={c.hqUserId} value={c.hqUserId}>
                {optionLabel(c)}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !selected}
            onClick={() => void add()}
            className="shrink-0 rounded-lg border border-[#3fb950] px-3 py-1.5 text-sm font-medium text-[#3fb950] hover:bg-[#3fb95020] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("add")}
          </button>
        </div>
      )}
    </section>
  );
}
