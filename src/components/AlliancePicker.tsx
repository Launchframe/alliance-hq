"use client";

import type { AccessibleAlliance } from "@/lib/alliance/types";
import { AppSelect } from "@/components/ui/AppSelect";

type Props = {
  alliances: AccessibleAlliance[];
  selectedAllianceId: string;
  onSelect: (allianceId: string) => void;
  label: string;
  hint?: string;
  emptyMessage?: string;
  loading?: boolean;
  loadingMessage?: string;
};

export function AlliancePicker({
  alliances,
  selectedAllianceId,
  onSelect,
  label,
  hint,
  emptyMessage,
  loading = false,
  loadingMessage,
}: Props) {
  if (loading) {
    return (
      <div className="text-sm text-[#8b949e]">
        {loadingMessage ?? "Loading alliances…"}
      </div>
    );
  }

  if (alliances.length === 0) {
    return (
      <div className="rounded-lg border border-[#f85149]/40 bg-[#f8514910] px-3 py-2 text-sm text-[#f85149]">
        {emptyMessage ??
          "No alliance admin access found. You must be owner or collaborator on Ashed."}
      </div>
    );
  }

  if (alliances.length === 1) {
    const only = alliances[0];
    return (
      <div className="rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm">
        <p className="font-medium">
          {only.tag}
          {only.name ? ` — ${only.name}` : ""}
        </p>
        <p className="mt-1 text-xs capitalize text-[#8b949e]">
          {only.accessRole}
        </p>
        {hint ? <p className="mt-2 text-xs text-[#8b949e]">{hint}</p> : null}
      </div>
    );
  }

  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs text-[#8b949e]">{label}</span>
      <AppSelect
        value={selectedAllianceId}
        onChange={onSelect}
        placeholder="Select an alliance…"
        aria-label={label}
        options={alliances.map((alliance) => ({
          value: alliance.id,
          label: `${alliance.tag}${alliance.name ? ` — ${alliance.name}` : ""} (${alliance.accessRole})`,
        }))}
      />
      {hint ? <p className="mt-1 text-xs text-[#8b949e]">{hint}</p> : null}
    </label>
  );
}
