"use client";

import * as React from "react";
import { Bug, MessageSquareText, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { FEEDBACK_FAB_FIXED_CLASSES } from "@/lib/feedback/fab-layout";

const DISCORD_ICON_SRC =
  "/discord-communication-interaction-message-network.svg";

type Props = {
  visible: boolean;
  onReportBug: () => void;
  onCorrectTranslation: () => void;
  onLeaveFeedback: () => void;
  onGetInTouch: () => void;
};

function FabMenuIcon({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-[#8b949e]">
      {children}
    </span>
  );
}

export function FeedbackFab({
  visible,
  onReportBug,
  onCorrectTranslation,
  onLeaveFeedback,
  onGetInTouch,
}: Props) {
  const t = useTranslations("feedback.fab");
  const [open, setOpen] = React.useState(false);

  if (!visible) return null;

  return (
    <div className={FEEDBACK_FAB_FIXED_CLASSES}>
      {open ? (
        <div className="pointer-events-auto absolute bottom-16 right-0 w-56 rounded-xl border-2 border-[#484f58] bg-[#21262d] p-2 shadow-2xl shadow-black/60 ring-1 ring-white/10">
          <div className="grid gap-1">
            <Button
              variant="ghost"
              className="w-full justify-start gap-2"
              onClick={() => {
                setOpen(false);
                onReportBug();
              }}
            >
              <FabMenuIcon>
                <Bug className="h-4 w-4" aria-hidden />
              </FabMenuIcon>
              {t("reportBug")}
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start gap-2"
              onClick={() => {
                setOpen(false);
                onCorrectTranslation();
              }}
            >
              <FabMenuIcon>
                <Pencil className="h-4 w-4" aria-hidden />
              </FabMenuIcon>
              {t("correctTranslation")}
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start gap-2"
              onClick={() => {
                setOpen(false);
                onLeaveFeedback();
              }}
            >
              <FabMenuIcon>
                <MessageSquareText className="h-4 w-4" aria-hidden />
              </FabMenuIcon>
              {t("leaveFeedback")}
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start gap-2"
              onClick={() => {
                setOpen(false);
                onGetInTouch();
              }}
            >
              <FabMenuIcon>
                <img
                  src={DISCORD_ICON_SRC}
                  alt=""
                  aria-hidden
                  className="h-4 w-4"
                />
              </FabMenuIcon>
              {t("getInTouch")}
            </Button>
          </div>
        </div>
      ) : null}

      <Button
        size="icon"
        className="pointer-events-auto h-14 w-14 rounded-full shadow-lg"
        aria-label={t("openMenu")}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Bug className="h-6 w-6" aria-hidden />
      </Button>
    </div>
  );
}
