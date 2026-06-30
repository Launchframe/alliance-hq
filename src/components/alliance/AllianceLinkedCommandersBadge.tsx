"use client";

type Props = {
  label: string;
};

export function AllianceLinkedCommandersBadge({ label }: Props) {
  return (
    <span className="shrink-0 rounded bg-[#238636]/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#3fb950]">
      {label}
    </span>
  );
}
