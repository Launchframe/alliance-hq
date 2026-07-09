type Props = {
  count: number;
  className?: string;
};

function formatCount(count: number): string {
  if (count > 99) {
    return "99+";
  }
  return String(count);
}

export function NeedsAttentionBadge({ count, className }: Props) {
  if (count < 1) {
    return null;
  }

  return (
    <span
      className={
        className ??
        "ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-hq-danger px-1.5 text-[10px] font-semibold leading-none text-white"
      }
      aria-hidden
    >
      {formatCount(count)}
    </span>
  );
}
