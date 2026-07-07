export default function AppSegmentLoading() {
  return (
    <div className="flex min-h-[12rem] flex-col gap-4" aria-busy="true" aria-live="polite">
      <div className="h-8 w-48 animate-pulse rounded-lg bg-hq-surface-muted" />
      <div className="h-4 w-full max-w-xl animate-pulse rounded bg-hq-surface-muted" />
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <div className="h-28 animate-pulse rounded-xl bg-hq-surface-muted" />
        <div className="h-28 animate-pulse rounded-xl bg-hq-surface-muted" />
      </div>
      <div className="h-40 animate-pulse rounded-xl bg-hq-surface-muted" />
    </div>
  );
}
