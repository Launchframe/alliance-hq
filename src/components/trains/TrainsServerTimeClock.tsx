"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Dialog } from "@/components/ui/dialog";
import { SERVER_TIME_IANA } from "@/lib/timezone/constants";
import {
  formatServerClockDate,
  formatServerClockTime,
  resolveTrainNextDeparture,
} from "@/lib/trains/trains-server-time.shared";

type Props = {
  selectedDate: string;
  today: string;
  lockedAt: string | null;
};

function AnalogClockFace({ now }: { now: Date }) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SERVER_TIME_IANA,
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const second = Number(parts.find((p) => p.type === "second")?.value ?? 0);

  const hourAngle = ((hour % 12) + minute / 60) * 30 - 90;
  const minuteAngle = (minute + second / 60) * 6 - 90;
  const secondAngle = second * 6 - 90;

  return (
    <svg
      viewBox="0 0 120 120"
      className="mx-auto h-28 w-28 text-[#e6edf3]"
      aria-hidden
    >
      <circle cx="60" cy="60" r="54" fill="#0d1117" stroke="#30363d" strokeWidth="2" />
      {Array.from({ length: 12 }, (_, i) => {
        const angle = (i * 30 * Math.PI) / 180;
        const x1 = 60 + Math.sin(angle) * 44;
        const y1 = 60 - Math.cos(angle) * 44;
        const x2 = 60 + Math.sin(angle) * 50;
        const y2 = 60 - Math.cos(angle) * 50;
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="#484f58"
            strokeWidth={i % 3 === 0 ? 2 : 1}
          />
        );
      })}
      <line
        x1="60"
        y1="60"
        x2={60 + Math.cos((hourAngle * Math.PI) / 180) * 28}
        y2={60 + Math.sin((hourAngle * Math.PI) / 180) * 28}
        stroke="#e6edf3"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <line
        x1="60"
        y1="60"
        x2={60 + Math.cos((minuteAngle * Math.PI) / 180) * 38}
        y2={60 + Math.sin((minuteAngle * Math.PI) / 180) * 38}
        stroke="#58a6ff"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="60"
        y1="60"
        x2={60 + Math.cos((secondAngle * Math.PI) / 180) * 42}
        y2={60 + Math.sin((secondAngle * Math.PI) / 180) * 42}
        stroke="#f85149"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <circle cx="60" cy="60" r="3" fill="#e6edf3" />
    </svg>
  );
}

export function TrainsServerTimeClock({
  selectedDate,
  today,
  lockedAt,
}: Props) {
  const t = useTranslations("trains.serverTimeClock");
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const badgeLine = useMemo(
    () =>
      t("currentLive", {
        date: formatServerClockDate(now),
        time: formatServerClockTime(now),
      }),
    [now, t],
  );

  const departure = useMemo(
    () =>
      resolveTrainNextDeparture({
        selectedDate,
        today,
        lockedAtIso: lockedAt,
        now,
      }),
    [lockedAt, now, selectedDate, today],
  );

  const departureLabel =
    departure.state === "awaiting_selection"
      ? t("departure.awaiting")
      : departure.state === "on_platform"
        ? t("departure.onPlatform")
        : t("departure.reset", { date: departure.resetDate ?? "" });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex rounded-lg border border-[#30363d] bg-[#0d1117]/80 px-2.5 py-1 text-[10px] tabular-nums text-[#8b949e] transition-colors hover:border-[#58a6ff]/40 hover:text-[#c9d1d9]"
        data-testid="trains-server-time-notice"
        aria-label={t("openBoard")}
      >
        {badgeLine}
      </button>

      <Dialog open={open} onOpenChange={setOpen} title={t("boardTitle")}>
        <div className="space-y-4">
          <AnalogClockFace now={now} />
          <p className="text-center text-sm tabular-nums text-[#c9d1d9]">
            {formatServerClockDate(now)} · {formatServerClockTime(now)}
          </p>
          <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8b949e]">
              {t("departureHeading", { date: selectedDate.slice(5) })}
            </p>
            <p className="mt-1 text-sm font-medium text-[#e6edf3]">
              {departureLabel}
            </p>
          </div>
          <p className="text-xs text-[#8b949e]">{t("timezoneNote")}</p>
        </div>
      </Dialog>
    </>
  );
}
