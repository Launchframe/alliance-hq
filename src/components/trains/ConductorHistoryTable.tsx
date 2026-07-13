"use client";

import type { WeekConductorRecordSummary } from "@/lib/trains/load-dashboard";
import { formatBrowserLocalDateTime } from "@/lib/timezone/format";

type Props = {
  rows: WeekConductorRecordSummary[];
  labels: {
    title: string;
    empty: string;
    date: string;
    conductor: string;
    vip: string;
    guardian: string;
    locked: string;
    noneYet: string;
    guardianIsVip: string;
    guardianIsConductor: string;
  };
  mechanismLabels: Record<string, string>;
};

function guardianName(row: WeekConductorRecordSummary): string | null {
  if (row.guardianIsVip) return row.vipMemberName;
  return row.conductorMemberName;
}

export function ConductorHistoryTable({
  rows,
  labels,
  mechanismLabels,
}: Props) {
  if (rows.length === 0) {
    return (
      <section className="rounded-2xl border border-hq-border bg-hq-surface p-5">
        <h2 className="text-lg font-semibold text-hq-fg">{labels.title}</h2>
        <p className="mt-2 text-sm text-hq-fg-muted">{labels.empty}</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-hq-border bg-hq-surface p-5">
      <h2 className="text-lg font-semibold text-hq-fg">{labels.title}</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead>
            <tr className="border-b border-hq-border text-xs uppercase tracking-wide text-hq-fg-muted">
              <th className="px-2 py-2 font-medium">{labels.date}</th>
              <th className="px-2 py-2 font-medium">{labels.conductor}</th>
              <th className="px-2 py-2 font-medium">{labels.vip}</th>
              <th className="px-2 py-2 font-medium">{labels.guardian}</th>
              <th className="px-2 py-2 font-medium">{labels.locked}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const guardian = guardianName(row);
              const conductorMech =
                row.conductorMechanism != null
                  ? (mechanismLabels[row.conductorMechanism] ??
                    row.conductorMechanism)
                  : null;
              const vipMech =
                row.vipMechanism != null
                  ? (mechanismLabels[row.vipMechanism] ?? row.vipMechanism)
                  : null;

              return (
                <tr
                  key={row.id}
                  className="border-b border-hq-border/60 last:border-0"
                >
                  <td className="px-2 py-2.5 tabular-nums text-hq-fg">
                    {row.date}
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="font-medium text-hq-fg">
                      {row.conductorMemberName ?? labels.noneYet}
                    </div>
                    {conductorMech ? (
                      <div className="text-xs text-hq-fg-muted">{conductorMech}</div>
                    ) : null}
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="font-medium text-hq-fg">
                      {row.vipMemberName ?? labels.noneYet}
                    </div>
                    {vipMech ? (
                      <div className="text-xs text-hq-fg-muted">{vipMech}</div>
                    ) : null}
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="font-medium text-hq-fg">
                      {guardian ?? labels.noneYet}
                    </div>
                    <div className="text-xs text-hq-fg-muted">
                      {row.guardianIsVip
                        ? labels.guardianIsVip
                        : labels.guardianIsConductor}
                    </div>
                  </td>
                  <td className="px-2 py-2.5 text-xs text-hq-fg-muted">
                    {row.lockedAt
                      ? formatBrowserLocalDateTime(row.lockedAt)
                      : labels.noneYet}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
