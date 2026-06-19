"use client";

import type { WeekConductorRecordSummary } from "@/lib/trains/load-dashboard";

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
      <section className="rounded-2xl border border-[#30363d] bg-[#161b22] p-5">
        <h2 className="text-lg font-semibold text-[#e6edf3]">{labels.title}</h2>
        <p className="mt-2 text-sm text-[#8b949e]">{labels.empty}</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-[#30363d] bg-[#161b22] p-5">
      <h2 className="text-lg font-semibold text-[#e6edf3]">{labels.title}</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead>
            <tr className="border-b border-[#30363d] text-xs uppercase tracking-wide text-[#8b949e]">
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
                  className="border-b border-[#30363d]/60 last:border-0"
                >
                  <td className="px-2 py-2.5 tabular-nums text-[#e6edf3]">
                    {row.date}
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="font-medium text-[#e6edf3]">
                      {row.conductorMemberName ?? labels.noneYet}
                    </div>
                    {conductorMech ? (
                      <div className="text-xs text-[#8b949e]">{conductorMech}</div>
                    ) : null}
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="font-medium text-[#e6edf3]">
                      {row.vipMemberName ?? labels.noneYet}
                    </div>
                    {vipMech ? (
                      <div className="text-xs text-[#8b949e]">{vipMech}</div>
                    ) : null}
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="font-medium text-[#e6edf3]">
                      {guardian ?? labels.noneYet}
                    </div>
                    <div className="text-xs text-[#8b949e]">
                      {row.guardianIsVip
                        ? labels.guardianIsVip
                        : labels.guardianIsConductor}
                    </div>
                  </td>
                  <td className="px-2 py-2.5 text-xs text-[#8b949e]">
                    {row.lockedAt
                      ? new Date(row.lockedAt).toLocaleString()
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
