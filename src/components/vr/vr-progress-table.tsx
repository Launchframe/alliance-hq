"use client";

import type { MyVrEvent } from "@/lib/vr/my-vr.shared";
import { VR_STEP } from "@/lib/vr/validation";

import { MY_VR_COPY } from "./my-vr-copy.pending";

type Props = {
  events: MyVrEvent[];
};

function formatChange(event: MyVrEvent): string {
  if (event.previousBaseVr == null) {
    return MY_VR_COPY.changeSet;
  }
  const delta = event.baseVr - event.previousBaseVr;
  if (delta === VR_STEP) {
    return MY_VR_COPY.changeBump;
  }
  return MY_VR_COPY.changeFrom.replace(
    "{previous}",
    String(event.previousBaseVr),
  );
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function VrProgressTable({ events }: Props) {
  const rows = [...events].reverse();

  if (rows.length === 0) {
    return (
      <p className="text-sm text-[#8b949e]">{MY_VR_COPY.tableEmpty}</p>
    );
  }

  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full min-w-[280px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-[#30363d] text-left text-[#8b949e]">
            <th className="px-2 py-2 font-medium">{MY_VR_COPY.tableDate}</th>
            <th className="px-2 py-2 font-medium">{MY_VR_COPY.tableLevel}</th>
            <th className="px-2 py-2 font-medium">{MY_VR_COPY.tableChange}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((event) => (
            <tr
              key={`${event.createdAt}-${event.baseVr}`}
              className="border-b border-[#21262d] text-[#e6edf3]"
            >
              <td className="px-2 py-2 whitespace-nowrap">
                {formatDateTime(event.createdAt)}
              </td>
              <td className="px-2 py-2 font-mono font-semibold">{event.baseVr}</td>
              <td className="px-2 py-2 text-[#8b949e]">{formatChange(event)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
