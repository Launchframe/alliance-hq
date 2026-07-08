"use client";

type Props = {
  label: string;
  title?: string;
};

export function OAuthIdentitySplitBadge({ label, title }: Props) {
  return (
    <span
      className="shrink-0 rounded bg-[#d29922]/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#d29922]"
      title={title}
    >
      {label}
    </span>
  );
}
