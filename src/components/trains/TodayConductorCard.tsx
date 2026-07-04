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
  showAnnounceAction?: boolean;
  onAnnounce?: () => void;
  announceLabel: string;
  "data-testid"?: string;
};

export function TodayConductorCard({
  record,
  stats,
  dayLabel,
  labels,
  substituteBadge,
  showAnnounceAction = false,
  onAnnounce,
  announceLabel,
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
      className="rounded-2xl border border-[#30363d] bg-[#161b22] p-5"
      data-testid={dataTestId}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[#e6edf3]">{dayLabel}</h2>
          <p className="mt-1 text-3xl font-bold tracking-tight text-[#58a6ff]">
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
        <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3">
          <div className="text-xs uppercase tracking-wide text-[#8b949e]">
            {labels.vip}
          </div>
          <div className="mt-1 text-lg font-medium text-[#e6edf3]">
            {record?.vipMemberName ?? labels.noneYet}
          </div>
        </div>
        <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3">
          <div className="text-xs uppercase tracking-wide text-[#8b949e]">
            {labels.guardian}
          </div>
          <div className="mt-1 text-lg font-medium text-[#e6edf3]">
            {hasGuardianContext ? (guardianName ?? labels.noneYet) : labels.noneYet}
          </div>
          {hasGuardianContext ? (
            <div className="mt-1 text-xs text-[#8b949e]">
              {record?.guardianIsVip
                ? labels.guardianIsVip
                : labels.guardianIsConductor}
            </div>
          ) : null}
        </div>
        {stats ? (
          <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3 text-sm text-[#8b949e] sm:col-span-2 lg:col-span-1">
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

      {locked && showAnnounceAction && onAnnounce ? (
        <div className="mt-4 border-t border-[#30363d] pt-4">
          <button
            type="button"
            onClick={onAnnounce}
            className="w-full rounded-lg bg-[#8957e5] px-4 py-2 text-sm font-medium text-white hover:bg-[#9d6ff0] sm:w-auto"
            data-testid="trains-announce-wizard-open"
          >
            {announceLabel}
          </button>
        </div>
      ) : null}
    </section>
  );
}
