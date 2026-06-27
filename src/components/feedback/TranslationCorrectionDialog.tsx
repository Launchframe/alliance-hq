"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { useLocale, useMessages, useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  handleTextareaEnterSubmit,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";
import type { SelectionAnchor } from "@/lib/feedback/text-selection";
import { resolveTranslationKeysFromClient } from "@/lib/feedback/translation-key-resolve";
import { submitTranslationReport } from "@/lib/feedback/client-api";

const MAX_DISPLAY_SNIPPET = 120;

function truncate(text: string) {
  if (text.length <= MAX_DISPLAY_SNIPPET) return text;
  return `${text.slice(0, MAX_DISPLAY_SNIPPET)}…`;
}

type FormProps = {
  selectionText: string;
  onClose: () => void;
  onComplete: () => void;
};

function TranslationCorrectionForm({
  selectionText,
  onClose,
  onComplete,
}: FormProps) {
  const t = useTranslations("feedback.translation");
  const locale = useLocale();
  const messages = useMessages();
  const pathname = usePathname();
  const [suggested, setSuggested] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

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

  if (success) {
    return (
      <div className="space-y-3">
        <p className="text-sm">{t("thankYou")}</p>
        <Button className="w-full" onClick={onComplete}>
          {t("done")}
        </Button>
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        preventDefaultFormSubmit(event);
        void handleSubmit();
      }}
    >
      <p id="translation-correction-dialog-title" className="text-sm text-[#8b949e]">
        {t("selectedLabel", { text: truncate(selectionText) })}
      </p>
      <label className="block space-y-1 text-sm">
        <span className="text-[#8b949e]">{t("correctionLabel")}</span>
        <Textarea
          value={suggested}
          onChange={(e) => setSuggested(e.target.value)}
          enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
          onKeyDown={(e) =>
            handleTextareaEnterSubmit(e, () => {
              void handleSubmit();
            })
          }
          rows={3}
        />
      </label>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button
          type="submit"
          className="flex-1"
          disabled={submitting}
        >
          {submitting ? t("submitting") : t("submit")}
        </Button>
      </div>
    </form>
  );
}

type Props = {
  open: boolean;
  formKey: string;
  anchor: SelectionAnchor | null;
  selectionText: string;
  onClose: () => void;
  onComplete: () => void;
};

export function TranslationCorrectionDialog({
  open,
  formKey,
  anchor,
  selectionText,
  onClose,
  onComplete,
}: Props) {
  const [mounted] = React.useState(() => typeof document !== "undefined");

  if (!open || !anchor || !mounted) return null;

  return createPortal(
    <div
      className="fixed z-95 w-[min(96vw,24rem)] rounded-xl border border-[#30363d] bg-[#161b22] p-4 shadow-xl"
      style={{ top: anchor.top, left: anchor.left }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="translation-correction-dialog-title"
    >
      <TranslationCorrectionForm
        key={formKey}
        selectionText={selectionText}
        onClose={onClose}
        onComplete={onComplete}
      />
    </div>,
    document.body,
  );
}
