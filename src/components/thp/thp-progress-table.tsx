"use client";

import { useTranslations } from "next-intl";

import { formatBrowserLocalDateTime } from "@/lib/timezone/format";
import { THP_BREAKDOWN_KEYS, type MyThpEvent } from "@/lib/thp/my-thp.shared";

type Props = {
  events: MyThpEvent[];
};

function formatDateTime(iso: string): string {
  return formatBrowserLocalDateTime(iso, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const KNOWN_SOURCES = new Set(["web", "discord", "ocr"]);

export function ThpProgressTable({ events }: Props) {
  const t = useTranslations("myThp");

  function formatChange(event: MyThpEvent): string {
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
              <td className="px-2 py-2 text-hq-fg-muted">
                <div>{formatChange(event)}</div>
                {event.breakdown ? (
                  <details className="mt-1">
                    <summary
                      className="cursor-pointer text-xs text-hq-accent"
                      data-testid="my-thp-table-breakdown-toggle"
                    >
                      {t("tableBreakdown")}
                    </summary>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3">
                      {THP_BREAKDOWN_KEYS.map((key) => (
                        <div key={key} className="min-w-0">
                          <dt className="truncate text-[11px] text-hq-fg-subtle">
                            {t(`breakdownFields.${key}`)}
                          </dt>
                          <dd className="font-mono text-xs text-hq-fg">
                            {event.breakdown![key].toLocaleString()}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
