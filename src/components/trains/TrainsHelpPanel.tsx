"use client";

import { CircleHelp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { Dialog } from "@/components/ui/dialog";
import { SERVER_TIME_IANA } from "@/lib/timezone/constants";
import { formatServerCalendarDate } from "@/lib/trains/game-time";

type Props = {
  showTakeTour?: boolean;
  onTakeTour?: () => void;
};

export function TrainsHelpPanel({ showTakeTour = false, onTakeTour }: Props) {
  const t = useTranslations("trains.help");
  const tServer = useTranslations("trains.serverTimeBadge");
  const [open, setOpen] = useState(false);

  const serverTimeLine = useMemo(() => {
    const now = new Date();
    const date = formatServerCalendarDate(now);
    const time = new Intl.DateTimeFormat(undefined, {
      timeZone: SERVER_TIME_IANA,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(now);
    return tServer("current", { date, time });
  }, [tServer]);

  const quickStartItems = [
    t("quickStart.paint"),
    t("quickStart.roll"),
    t("quickStart.lock"),
  ] as const;

  return (
    <>
      <button
        type="button"
        data-testid="trains-help-trigger"
        aria-label={t("openLabel")}
        onClick={() => setOpen(true)}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#30363d] bg-[#0d1117] text-[#8b949e] hover:bg-[#161b22] hover:text-[#e6edf3]"
      >
        <CircleHelp className="h-4 w-4" aria-hidden />
      </button>

      <Dialog open={open} onOpenChange={setOpen} title={t("title")}>
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[#e6edf3]">{t("title")}</h2>
            <p className="mt-2 text-sm leading-relaxed text-[#c9d1d9]">
              {t("serverTimeBody")}
            </p>
            <p className="mt-2 rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-xs tabular-nums text-[#8b949e]">
              {serverTimeLine}
            </p>
          </div>

          <div>
            <h3 className="text-sm font-medium text-[#e6edf3]">
              {t("quickStartTitle")}
            </h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[#c9d1d9]">
              {quickStartItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            {showTakeTour && onTakeTour ? (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onTakeTour();
                }}
                className="rounded-lg border border-[#8957e5]/50 bg-[#8957e5]/10 px-4 py-2 text-sm font-medium text-[#d2a8ff] hover:bg-[#8957e5]/20"
              >
                {t("takeTour")}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-[#30363d] px-4 py-2 text-sm font-medium text-[#e6edf3] hover:bg-[#0d1117]"
            >
              {t("close")}
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
