"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";

import { NeedsAttentionBadge } from "@/components/ui/NeedsAttentionBadge";
import { MEMBER_ROSTER_VIDEO_SCORE_TARGET } from "@/lib/members/ashed-member-record";
import { buildVideoUploadHref } from "@/lib/video/score-target-nav";

const UPLOAD_VIDEO_ITEMS = [
  { id: "vs-performance", labelKey: "vsPerformance" as const },
  { id: "donations", labelKey: "donations" as const },
  { id: "alliance-exercise", labelKey: "allianceExercise" as const },
  {
    id: MEMBER_ROSTER_VIDEO_SCORE_TARGET,
    labelKey: "memberRoster" as const,
    attention: true as const,
  },
  {
    id: "seasonal",
    labelKey: "kills" as const,
    boardKey: "kills" as const,
  },
  { id: "desert-storm", labelKey: "desertStorm" as const },
] as const;

type Props = {
  rosterVideoAttentionCount: number;
};

export function MembersUploadVideoMenu({ rosterVideoAttentionCount }: Props) {
  const t = useTranslations("members.uploadVideoMenu");
  const tNav = useTranslations("nav");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative w-full sm:w-auto">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        className="relative inline-flex w-full items-center justify-center rounded-lg border border-[#388bfd] bg-[#388bfd]/10 px-4 py-2 text-center text-sm text-hq-accent hover:bg-[#388bfd]/20 sm:w-auto"
        data-testid="members-upload-video-menu"
      >
        {t("trigger")}
        <NeedsAttentionBadge count={rosterVideoAttentionCount} />
        {rosterVideoAttentionCount > 0 ? (
          <span className="sr-only">{t("rosterAttention")}</span>
        ) : null}
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 min-w-[16rem] rounded-xl border border-hq-border bg-hq-surface p-2 shadow-lg"
        >
          <ul className="space-y-1">
            {UPLOAD_VIDEO_ITEMS.map((item) => {
              const href = buildVideoUploadHref(item.id, {
                boardKey: "boardKey" in item ? item.boardKey : null,
              });
              const label =
                item.labelKey === "memberRoster" || item.labelKey === "kills"
                  ? t(item.labelKey)
                  : tNav(item.labelKey);
              return (
                <li key={`${item.id}-${"boardKey" in item ? item.boardKey : ""}`}>
                  <Link
                    role="menuitem"
                    href={href}
                    onClick={() => setOpen(false)}
                    className="relative flex items-center justify-between rounded-lg px-3 py-2 text-sm text-hq-fg hover:bg-hq-surface-muted"
                    data-testid={`members-upload-video-${item.id}`}
                  >
                    <span>{label}</span>
                    {"attention" in item && item.attention ? (
                      <NeedsAttentionBadge count={rosterVideoAttentionCount} />
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
