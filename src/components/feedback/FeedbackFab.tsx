"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

type Props = {
  visible: boolean;
  onReportBug: () => void;
  onCorrectTranslation: () => void;
  onLeaveFeedback: () => void;
  onGetInTouch: () => void;
};

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
    <div className="fixed bottom-4 left-4 z-[55] md:bottom-5 md:left-5">
      {open ? (
        <div className="absolute bottom-16 left-0 w-56 rounded-xl border border-[#30363d] bg-[#161b22] p-2 shadow-xl">
          <div className="grid gap-1">
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={() => {
                setOpen(false);
                onReportBug();
              }}
            >
              {t("reportBug")}
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={() => {
                setOpen(false);
                onCorrectTranslation();
              }}
            >
              {t("correctTranslation")}
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={() => {
                setOpen(false);
                onLeaveFeedback();
              }}
            >
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
              <span>{t("getInTouch")}</span>
              <span aria-hidden="true">💬</span>
            </Button>
          </div>
        </div>
      ) : null}

      <Button
        size="icon"
        className="h-14 w-14 rounded-full shadow-lg"
        aria-label={t("openMenu")}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        💬
      </Button>
    </div>
  );
}
