"use client";

import * as React from "react";
import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";

import { TranslationCorrectionDialog } from "@/components/feedback/TranslationCorrectionDialog";
import { Button } from "@/components/ui/button";
import {
  readAppShellTextSelection,
  selectionAnchorFromWindow,
  type SelectionAnchor,
} from "@/lib/feedback/text-selection";

type Props = {
  active: boolean;
  onActiveChange: (active: boolean) => void;
};

export function TranslationCorrectionOverlay({
  active,
  onActiveChange,
}: Props) {
  const t = useTranslations("feedback.translation");
  const [selectionText, setSelectionText] = React.useState("");
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [dialogFormKey, setDialogFormKey] = React.useState("0");
  const [anchor, setAnchor] = React.useState<SelectionAnchor | null>(null);

  React.useEffect(() => {
    if (!active) return;

    function handleMouseUp() {
      const text = readAppShellTextSelection();
      if (!text) return;

      setSelectionText(text);
      setDialogFormKey(`${Date.now()}`);
      setDialogOpen(true);
      setAnchor(selectionAnchorFromWindow());
    }

    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, [active]);

  function closeAll() {
    setDialogOpen(false);
    onActiveChange(false);
  }

  if (!active) return null;

  return (
    <>
      <div
        role="status"
        aria-live="polite"
        className="fixed inset-x-0 top-0 z-120 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-b-2 border-[#9e6a03] bg-[#d29922] px-4 py-3 text-center shadow-[0_4px_24px_rgba(0,0,0,0.5)] sm:px-6 sm:py-3.5"
      >
        <span className="inline-flex max-w-3xl items-center gap-2 text-base font-semibold text-hq-canvas sm:text-lg">
          <Pencil className="h-5 w-5 shrink-0" aria-hidden />
          {t("selectPrompt")}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 border-hq-canvas/35 bg-hq-canvas/10 text-hq-canvas hover:bg-hq-canvas/20"
          onClick={() => onActiveChange(false)}
        >
          {t("cancelMode")}
        </Button>
      </div>

      <TranslationCorrectionDialog
        open={dialogOpen}
        formKey={dialogFormKey}
        anchor={anchor}
        selectionText={selectionText}
        onClose={() => setDialogOpen(false)}
        onComplete={closeAll}
      />
    </>
  );
}
