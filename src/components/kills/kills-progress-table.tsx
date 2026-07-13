"use client";

import { useTranslations } from "next-intl";

import { formatBrowserLocalDateTime } from "@/lib/timezone/format";
import type { MyKillsEvent } from "@/lib/kills/my-kills.shared";

type Props = {
  events: MyKillsEvent[];
};

function formatDateTime(iso: string): string {
  return formatBrowserLocalDateTime(iso, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const KNOWN_SOURCES = new Set(["web", "discord", "ashed_sync"]);

export function KillsProgressTable({ events }: Props) {
  const t = useTranslations("myKills");

  function formatChange(event: MyKillsEvent): string {
    if (event.previousTotal == null) {
      return t("changeSet");
    }
    const delta = event.total - event.previousTotal;
    const sign = delta > 0 ? "+" : "";
    return t("changeFrom", {
      delta: `${sign}${delta.toLocaleString()}`,
      previous: event.previousTotal.toLocaleString(),
    });
  }

  function formatSource(source: string): string {
    return KNOWN_SOURCES.has(source)
      ? t(`source.${source}` as "source.web")
      : source;
  }

  const rows = [...events].reverse();

  if (rows.length === 0) {
    return <p className="text-sm text-hq-fg-muted">{t("tableEmpty")}</p>;
  }

  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full min-w-[420px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-hq-border text-left text-hq-fg-muted">
            <th className="px-2 py-2 font-medium">{t("tableDate")}</th>
            <th className="px-2 py-2 font-medium">{t("tableTotal")}</th>
            <th className="px-2 py-2 font-medium">{t("tableSource")}</th>
            <th className="px-2 py-2 font-medium">{t("tableChange")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((event) => (
            <tr
              key={`${event.createdAt}-${event.total}`}
              className="border-b border-hq-surface-muted align-top text-hq-fg"
            >
              <td className="px-2 py-2 whitespace-nowrap">
                {formatDateTime(event.createdAt)}
              </td>
              <td className="px-2 py-2 font-mono font-semibold">
                {event.total.toLocaleString()}
              </td>
              <td className="px-2 py-2 text-hq-fg-muted">{formatSource(event.source)}</td>
              <td className="px-2 py-2 text-hq-fg-muted">{formatChange(event)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
