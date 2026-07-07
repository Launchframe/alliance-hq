"use client";

type Props = {
  label: string;
};

export function AllianceLinkedCommandersBadge({ label }: Props) {
  return (
    <span className="shrink-0 rounded bg-hq-success/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-hq-green">
      {label}
    </span>
  );
}
