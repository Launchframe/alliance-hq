"use client";

type Props = {
  record: {
    conductorMemberName: string | null;
    vipMemberName: string | null;
    guardianIsVip?: boolean;
    conductorMechanism: string | null;
    vipMechanism: string | null;
    lockedAt: string | null;
    substituteForMemberName?: string | null;
  } | null;
  stats: {
    lastConductedDate: string | null;
    conductsThisYear: number;
  } | null;
  dayLabel: string;
  labels: {
    awaiting: string;
    vip: string;
    guardian: string;
    guardianIsVip: string;
    guardianIsConductor: string;
    locked: string;
    unlocked: string;
    lastConducted: string;
    conductsThisYear: string;
    noneYet: string;
  };
  substituteBadge?: string | null;
  "data-testid"?: string;
};

export function TodayConductorCard({
  record,
  stats,
  dayLabel,
  labels,
  substituteBadge,
  "data-testid": dataTestId,
}: Props) {
  const locked = Boolean(record?.lockedAt);
  const guardianName = record?.guardianIsVip
    ? record.vipMemberName
    : record?.conductorMemberName;
  const hasGuardianContext = Boolean(
    record?.conductorMemberName || record?.vipMemberName,
  );

  return (
    <section
      className="rounded-2xl border border-hq-border bg-hq-surface p-5"
      data-testid={dataTestId}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-hq-fg">{dayLabel}</h2>
          <p className="mt-1 text-3xl font-bold tracking-tight text-hq-accent">
            {record?.conductorMemberName ?? labels.awaiting}
          </p>
          {substituteBadge ? (
            <p className="mt-2 inline-flex rounded-full bg-[#8957e5]/15 px-3 py-1 text-xs font-medium text-[#d2a8ff]">
              {substituteBadge}
            </p>
          ) : null}
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            locked
              ? "bg-emerald-500/15 text-emerald-300"
              : "bg-amber-500/15 text-amber-300"
          }`}
        >
          {locked ? labels.locked : labels.unlocked}
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-xl border border-hq-border bg-hq-canvas p-3">
          <div className="text-xs uppercase tracking-wide text-hq-fg-muted">
            {labels.vip}
          </div>
          <div className="mt-1 text-lg font-medium text-hq-fg">
            {record?.vipMemberName ?? labels.noneYet}
          </div>
        </div>
        <div className="rounded-xl border border-hq-border bg-hq-canvas p-3">
          <div className="text-xs uppercase tracking-wide text-hq-fg-muted">
            {labels.guardian}
          </div>
          <div className="mt-1 text-lg font-medium text-hq-fg">
            {hasGuardianContext ? (guardianName ?? labels.noneYet) : labels.noneYet}
          </div>
          {hasGuardianContext ? (
            <div className="mt-1 text-xs text-hq-fg-muted">
              {record?.guardianIsVip
                ? labels.guardianIsVip
                : labels.guardianIsConductor}
            </div>
          ) : null}
        </div>
        {stats ? (
          <div className="rounded-xl border border-hq-border bg-hq-canvas p-3 text-sm text-hq-fg-muted sm:col-span-2 lg:col-span-1">
            <div>
              {labels.lastConducted}:{" "}
              <span className="text-hq-fg">
                {stats.lastConductedDate ?? labels.noneYet}
              </span>
            </div>
            <div className="mt-1">
              {labels.conductsThisYear}:{" "}
              <span className="text-hq-fg">{stats.conductsThisYear}</span>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
