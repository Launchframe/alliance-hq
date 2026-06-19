"use client";

type Props = {
  record: {
    conductorMemberName: string | null;
    vipMemberName: string | null;
    conductorMechanism: string | null;
    vipMechanism: string | null;
    lockedAt: string | null;
  } | null;
  stats: {
    lastConductedDate: string | null;
    conductsThisYear: number;
  } | null;
  dayLabel: string;
  labels: {
    awaiting: string;
    vip: string;
    locked: string;
    unlocked: string;
    lastConducted: string;
    conductsThisYear: string;
    noneYet: string;
  };
};

export function TodayConductorCard({ record, stats, dayLabel, labels }: Props) {
  const locked = Boolean(record?.lockedAt);

  return (
    <section className="rounded-2xl border border-[#30363d] bg-[#161b22] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[#e6edf3]">{dayLabel}</h2>
          <p className="mt-1 text-3xl font-bold tracking-tight text-[#58a6ff]">
            {record?.conductorMemberName ?? labels.awaiting}
          </p>
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

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3">
          <div className="text-xs uppercase tracking-wide text-[#8b949e]">
            {labels.vip}
          </div>
          <div className="mt-1 text-lg font-medium text-[#e6edf3]">
            {record?.vipMemberName ?? labels.noneYet}
          </div>
        </div>
        {stats ? (
          <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3 text-sm text-[#8b949e]">
            <div>
              {labels.lastConducted}:{" "}
              <span className="text-[#e6edf3]">
                {stats.lastConductedDate ?? labels.noneYet}
              </span>
            </div>
            <div className="mt-1">
              {labels.conductsThisYear}:{" "}
              <span className="text-[#e6edf3]">{stats.conductsThisYear}</span>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
