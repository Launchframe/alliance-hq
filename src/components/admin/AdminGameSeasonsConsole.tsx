"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import {
  RecordDetailCard,
  RecordDetailField,
  ResponsiveRecordViews,
} from "@/components/ui/ResponsiveRecordViews";
import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";

type GameSeasonRow = {
  id: string;
  seasonNumber: number;
  maxProfessionLevel: number | null;
};

type DraftRow = {
  maxProfessionLevel: string;
};

function draftsFromRows(rows: GameSeasonRow[]): Record<string, DraftRow> {
  return Object.fromEntries(
    rows.map((row) => [
      row.id,
      {
        maxProfessionLevel:
          row.maxProfessionLevel != null ? String(row.maxProfessionLevel) : "",
      },
    ]),
  );
}

export function AdminGameSeasonsConsole() {
  const t = useTranslations("admin.gameSeasonsPage");
  const [seasons, setSeasons] = useState<GameSeasonRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftRow>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setError(null);
      try {
        const res = await fetch("/api/admin/game-seasons");
        if (!res.ok) {
          setError(t("loadFailed"));
          return;
        }
        const body = (await res.json()) as { seasons: GameSeasonRow[] };
        const rows = body.seasons ?? [];
        setSeasons(rows);
        setDrafts(draftsFromRows(rows));
      } catch (e) {
        setError(e instanceof Error ? e.message : t("loadFailed"));
      } finally {
        setLoading(false);
      }
    })();
  }, [t]);

  async function saveSeason(row: GameSeasonRow) {
    const draft = drafts[row.id];
    if (!draft) return;

    const professionRaw = draft.maxProfessionLevel.trim();
    const maxProfessionLevel =
      professionRaw === "" ? null : Number.parseInt(professionRaw, 10);
    if (
      professionRaw !== "" &&
      (!Number.isFinite(maxProfessionLevel) || maxProfessionLevel! < 1)
    ) {
      setError(t("invalidProfessionLevel"));
      return;
    }

    setSavingId(row.id);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/game-seasons", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seasonId: row.id,
          maxProfessionLevel,
        }),
      });
      if (!res.ok) {
        setError(t("saveFailed"));
        return;
      }
      const body = (await res.json()) as { season: GameSeasonRow };
      setSeasons((current) =>
        current.map((season) =>
          season.id === row.id ? body.season : season,
        ),
      );
      setDrafts((current) => ({
        ...current,
        [row.id]: draftsFromRows([body.season])[row.id]!,
      }));
      setMessage(t("saveSuccess", { season: row.seasonNumber }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setSavingId(null);
    }
  }

  function updateDraft(
    seasonId: string,
    field: keyof DraftRow,
    value: string,
  ) {
    setDrafts((current) => ({
      ...current,
      [seasonId]: {
        ...current[seasonId],
        [field]: value,
      },
    }));
  }

  const desktopTable = (
    <div className="overflow-x-auto rounded-xl border border-[#30363d]">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-[#161b22] text-[#8b949e]">
          <tr>
            <th className="px-4 py-3 font-medium">{t("seasonNumber")}</th>
            <th className="px-4 py-3 font-medium">{t("maxProfessionLevel")}</th>
            <th className="px-4 py-3 font-medium">{t("actions")}</th>
          </tr>
        </thead>
        <tbody>
          {seasons.map((row) => (
            <tr key={row.id} className="border-t border-[#30363d]">
              <td className="px-4 py-3 font-mono">S{row.seasonNumber}</td>
              <td className="px-4 py-3">
                <input
                  type="number"
                  min={1}
                  placeholder={t("professionUnset")}
                  form={`season-save-${row.id}`}
                  value={drafts[row.id]?.maxProfessionLevel ?? ""}
                  onChange={(event) =>
                    updateDraft(
                      row.id,
                      "maxProfessionLevel",
                      event.target.value,
                    )
                  }
                  enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
                  className="w-28 rounded-lg border border-[#30363d] bg-[#0d1117] px-2 py-1"
                />
              </td>
              <td className="px-4 py-3">
                <form
                  id={`season-save-${row.id}`}
                  className="inline"
                  onSubmit={(event) => {
                    preventDefaultFormSubmit(event);
                    void saveSeason(row);
                  }}
                >
                  <button
                    type="submit"
                    disabled={savingId === row.id}
                    className="rounded-lg border border-[#238636] bg-[#238636] px-3 py-1.5 text-xs text-white disabled:opacity-50"
                  >
                    {savingId === row.id ? t("saving") : t("save")}
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const mobileCards = seasons.map((row) => (
    <RecordDetailCard key={row.id}>
      <RecordDetailField label={t("seasonNumber")}>
        S{row.seasonNumber}
      </RecordDetailField>
      <form
        onSubmit={(event) => {
          preventDefaultFormSubmit(event);
          void saveSeason(row);
        }}
      >
      <RecordDetailField label={t("maxProfessionLevel")}>
        <input
          type="number"
          min={1}
          placeholder={t("professionUnset")}
          value={drafts[row.id]?.maxProfessionLevel ?? ""}
          onChange={(event) =>
            updateDraft(row.id, "maxProfessionLevel", event.target.value)
          }
          enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
          className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-2 py-1"
        />
      </RecordDetailField>
      <button
        type="submit"
        disabled={savingId === row.id}
        className="mt-2 w-full rounded-lg border border-[#238636] bg-[#238636] px-3 py-2 text-sm text-white disabled:opacity-50"
      >
        {savingId === row.id ? t("saving") : t("save")}
      </button>
      </form>
    </RecordDetailCard>
  ));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="mt-1 text-sm text-[#8b949e]">{t("subtitle")}</p>
      </div>

      {loading ? (
        <p className="text-sm text-[#8b949e]">{t("loading")}</p>
      ) : seasons.length === 0 ? (
        <p className="text-sm text-[#8b949e]">{t("empty")}</p>
      ) : (
        <ResponsiveRecordViews
          mobileCards={<div className="space-y-3 md:hidden">{mobileCards}</div>}
          desktopTable={<div className="hidden md:block">{desktopTable}</div>}
        />
      )}

      {message ? <p className="text-sm text-[#3fb950]">{message}</p> : null}
      {error ? <p className="text-sm text-[#f85149]">{error}</p> : null}
    </div>
  );
}
