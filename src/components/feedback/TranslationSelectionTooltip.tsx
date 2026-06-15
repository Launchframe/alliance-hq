"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";

import { TranslationCorrectionDialog } from "@/components/feedback/TranslationCorrectionDialog";
import {
  clearWindowSelection,
  readAppShellTextSelection,
  selectionAnchorFromWindow,
  type SelectionAnchor,
} from "@/lib/feedback/text-selection";

type Props = {
  blocked: boolean;
};

export function TranslationSelectionTooltip({ blocked }: Props) {
  const t = useTranslations("feedback.translation");
  const [tooltip, setTooltip] = React.useState<{
    text: string;
    anchor: SelectionAnchor;
  } | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [dialogSelection, setDialogSelection] = React.useState("");
  const [dialogAnchor, setDialogAnchor] = React.useState<SelectionAnchor | null>(
    null,
  );
  const [dialogFormKey, setDialogFormKey] = React.useState("0");
  const [mounted] = React.useState(() => typeof document !== "undefined");

  const dismissTooltip = React.useCallback(() => {
    setTooltip(null);
  }, []);

  React.useEffect(() => {
    if (blocked) return;

    function handleMouseUp(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        target instanceof Element &&
        target.closest("[data-translation-selection-ui]")
      ) {
        return;
      }

      const text = readAppShellTextSelection();
      if (!text) {
        dismissTooltip();
        return;
      }

      const anchor = selectionAnchorFromWindow(280);
      if (!anchor) {
        dismissTooltip();
        return;
      }

      setTooltip({ text, anchor });
      setDialogOpen(false);
    }

    function handleMouseDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-translation-selection-ui]")) return;
      dismissTooltip();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") dismissTooltip();
    }

    function handleScrollOrResize() {
      dismissTooltip();
    }

    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleScrollOrResize);
    window.addEventListener("scroll", handleScrollOrResize, true);
    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleScrollOrResize);
      window.removeEventListener("scroll", handleScrollOrResize, true);
    };
  }, [blocked, dismissTooltip]);

  function openDialogFromTooltip() {
    if (!tooltip) return;
    setDialogSelection(tooltip.text);
    setDialogAnchor(tooltip.anchor);
    setDialogFormKey(`${Date.now()}`);
    setDialogOpen(true);
    setTooltip(null);
    clearWindowSelection();
  }

  function closeDialog() {
    setDialogOpen(false);
  }

  function completeDialog() {
    setDialogOpen(false);
    setDialogSelection("");
    setDialogAnchor(null);
  }

  if (!mounted || blocked) return null;

  return (
    <>
      {tooltip && !dialogOpen
        ? createPortal(
            <div
              data-translation-selection-ui
              className="fixed z-94 max-w-[min(96vw,17.5rem)] rounded-lg border border-[#484f58] bg-[#21262d] p-1 shadow-xl ring-1 ring-white/10"
              style={{ top: tooltip.anchor.top, left: tooltip.anchor.left }}
            >
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-[#e6edf3] hover:bg-[#30363d]"
                onClick={openDialogFromTooltip}
              >
                <Pencil className="h-4 w-4 shrink-0 text-[#58a6ff]" aria-hidden />
                {t("suggestTooltip")}
              </button>
            </div>,
            document.body,
          )
        : null}

      <TranslationCorrectionDialog
        open={dialogOpen}
        formKey={dialogFormKey}
        anchor={dialogAnchor}
        selectionText={dialogSelection}
        onClose={closeDialog}
        onComplete={completeDialog}
      />
    </>
  );
}
