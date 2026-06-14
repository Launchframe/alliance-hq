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

export default function AdminHqEventsPage() {
  const t = useTranslations("admin");
  const [events, setEvents] = useState<HqEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/hq-events")
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return res.json() as Promise<{ events: HqEvent[] }>;
      })
      .then((data) => setEvents(data.events))
      .catch((err) =>
        setError(err instanceof Error ? err.message : t("loadFailed")),
      );
  }, [t]);

  if (error) {
    return <p className="text-sm text-red-400">{error}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-[#30363d]">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-[#161b22] text-[#8b949e]">
          <tr>
            <th className="px-4 py-2">{t("table.time")}</th>
            <th className="px-4 py-2">{t("table.name")}</th>
            <th className="px-4 py-2">{t("table.target")}</th>
            <th className="px-4 py-2">{t("table.status")}</th>
            <th className="px-4 py-2">{t("table.alliance")}</th>
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
              <td className="px-4 py-2 font-mono text-xs">{event.allianceId}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
