"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type HqEvent = {
  id: string;
  name: string;
  scoreTarget: string;
  allianceId: string;
  status: string;
  createdAt: string;
};

type HqSeries = {
  id: string;
  name: string;
  scoreTarget: string;
  allianceId: string;
};

type HqBoard = {
  id: string;
  hqEventId: string;
  boardKey: string;
  name: string | null;
};

export default function AdminHqEventsPage() {
  const t = useTranslations("admin");
  const tEvents = useTranslations("admin.hqEventsPage");
  const [tab, setTab] = useState<"events" | "series" | "boards">("events");
  const [events, setEvents] = useState<HqEvent[]>([]);
  const [series, setSeries] = useState<HqSeries[]>([]);
  const [boards, setBoards] = useState<HqBoard[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/hq-events")
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return res.json() as Promise<{
          events: HqEvent[];
          series: HqSeries[];
          boards: HqBoard[];
        }>;
      })
      .then((data) => {
        setEvents(data.events);
        setSeries(data.series);
        setBoards(data.boards);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : t("loadFailed")),
      );
  }, [t]);

  if (error) {
    return <p className="text-sm text-red-400">{error}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["events", "series", "boards"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              tab === key
                ? "bg-[#1f3d5c] text-[#58a6ff]"
                : "text-[#8b949e] hover:bg-[#21262d]"
            }`}
          >
            {tEvents(`tabs.${key}`)}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-[#30363d]">
        {tab === "events" ? (
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[#161b22] text-[#8b949e]">
              <tr>
                <th className="px-4 py-2">{t("table.time")}</th>
                <th className="px-4 py-2">{t("table.name")}</th>
                <th className="px-4 py-2">{t("table.target")}</th>
                <th className="px-4 py-2">{t("table.status")}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-t border-[#30363d]">
                  <td className="px-4 py-2 whitespace-nowrap text-[#8b949e]">
                    {new Date(event.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2">{event.name}</td>
                  <td className="px-4 py-2">{event.scoreTarget}</td>
                  <td className="px-4 py-2">{event.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {tab === "series" ? (
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[#161b22] text-[#8b949e]">
              <tr>
                <th className="px-4 py-2">{t("table.name")}</th>
                <th className="px-4 py-2">{t("table.target")}</th>
                <th className="px-4 py-2">{t("table.alliance")}</th>
              </tr>
            </thead>
            <tbody>
              {series.map((row) => (
                <tr key={row.id} className="border-t border-[#30363d]">
                  <td className="px-4 py-2">{row.name}</td>
                  <td className="px-4 py-2">{row.scoreTarget}</td>
                  <td className="px-4 py-2 font-mono text-xs">{row.allianceId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {tab === "boards" ? (
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[#161b22] text-[#8b949e]">
              <tr>
                <th className="px-4 py-2">{tEvents("boardKey")}</th>
                <th className="px-4 py-2">{t("table.name")}</th>
                <th className="px-4 py-2">{tEvents("eventId")}</th>
              </tr>
            </thead>
            <tbody>
              {boards.map((board) => (
                <tr key={board.id} className="border-t border-[#30363d]">
                  <td className="px-4 py-2">{board.boardKey}</td>
                  <td className="px-4 py-2">{board.name ?? "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs">{board.hqEventId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  );
}
