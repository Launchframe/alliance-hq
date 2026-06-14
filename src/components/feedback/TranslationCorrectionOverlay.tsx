"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { useLocale, useMessages, useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { resolveTranslationKeysFromClient } from "@/lib/feedback/translation-key-resolve";
import { submitTranslationReport } from "@/lib/feedback/client-api";

type Props = {
  active: boolean;
  onActiveChange: (active: boolean) => void;
};

const MAX_DISPLAY_SNIPPET = 120;

function truncate(text: string) {
  if (text.length <= MAX_DISPLAY_SNIPPET) return text;
  return `${text.slice(0, MAX_DISPLAY_SNIPPET)}…`;
}

export function TranslationCorrectionOverlay({
  active,
  onActiveChange,
}: Props) {
  const t = useTranslations("feedback.translation");
  const locale = useLocale();
  const messages = useMessages();
  const pathname = usePathname();
  const [selectionText, setSelectionText] = React.useState("");
  const [suggested, setSuggested] = React.useState("");
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [anchor, setAnchor] = React.useState<{ top: number; left: number } | null>(
    null,
  );
  const [mounted] = React.useState(() => typeof document !== "undefined");
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!active) return;
    function handleMouseUp(event: MouseEvent) {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      if (!text || text.length < 2) return;

      const target = event.target;
      if (!(target instanceof Node)) return;
      const shell = document.getElementById("hq-app-shell");
      if (shell && !shell.contains(target)) return;

      setSelectionText(text);
      setSuggested("");
      setSuccess(false);
      setError(null);
      setDialogOpen(true);

      const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
      const rect = range?.getBoundingClientRect();
      setAnchor(
        rect
          ? { top: rect.bottom + 8, left: Math.min(rect.left, window.innerWidth - 320) }
          : { top: 120, left: 24 },
      );
    }

    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, [active]);

  async function handleSubmit() {
    if (!suggested.trim()) {
      setError(t("correctionRequired"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const resolved = resolveTranslationKeysFromClient(
        messages as Record<string, unknown>,
        selectionText,
      );
      await submitTranslationReport({
        locale,
        displayedText: selectionText,
        suggestedTranslation: suggested.trim(),
        pagePath: pathname,
        i18nKey: resolved.i18nKey,
        candidateKeys: resolved.candidateKeys,
      });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("submitFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  function closeAll() {
    setDialogOpen(false);
    onActiveChange(false);
  }

  if (!active) return null;

  return (
    <>
      <div className="fixed inset-x-0 top-0 z-[90] border-b border-[#58a6ff]/40 bg-[#0d1117]/95 px-4 py-2 text-center text-sm text-[#e6edf3]">
        {t("selectPrompt")}{" "}
        <button
          type="button"
          className="ml-2 text-[#58a6ff] underline"
          onClick={() => onActiveChange(false)}
        >
          {t("cancelMode")}
        </button>
      </div>

      {dialogOpen && anchor && mounted
        ? createPortal(
            <div
              className="fixed z-[95] w-[min(96vw,24rem)] rounded-xl border border-[#30363d] bg-[#161b22] p-4 shadow-xl"
              style={{ top: anchor.top, left: anchor.left }}
            >
              {success ? (
                <div className="space-y-3">
                  <p className="text-sm">{t("thankYou")}</p>
                  <Button className="w-full" onClick={closeAll}>
                    {t("done")}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-[#8b949e]">
                    {t("selectedLabel", { text: truncate(selectionText) })}
                  </p>
                  <label className="block space-y-1 text-sm">
                    <span className="text-[#8b949e]">{t("correctionLabel")}</span>
                    <Textarea
                      value={suggested}
                      onChange={(e) => setSuggested(e.target.value)}
                      rows={3}
                    />
                  </label>
                  {error ? <p className="text-sm text-red-400">{error}</p> : null}
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      className="flex-1"
                      onClick={() => setDialogOpen(false)}
                    >
                      {t("cancel")}
                    </Button>
                    <Button
                      className="flex-1"
                      onClick={handleSubmit}
                      disabled={submitting}
                    >
                      {submitting ? t("submitting") : t("submit")}
                    </Button>
                  </div>
                </div>
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
