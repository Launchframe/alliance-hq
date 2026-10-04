"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  handleTextareaEnterSubmit,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";
import type {
  PairingImportEngStatus,
  PairingImportPreview,
  PairingImportWlStatus,
} from "@/lib/professions/pairing-import.shared";

type Props = {
  onApplied: () => void;
};

type ApplyResult = {
  assigned: number;
  skipped: number;
  failed: number;
  errors: string[];
};

function statusTone(status: PairingImportWlStatus | PairingImportEngStatus): string {
  if (status === "ready" || status === "will_set_profession" || status === "already") {
    return "text-hq-success";
  }
  if (status === "other_team" || status === "wrong_profession" || status === "duplicate_in_paste") {
    return "text-hq-warning";
  }
  return "text-hq-danger";
}

export function PairingImportPanel({ onApplied }: Props) {
  const t = useTranslations("professions.import");
  const errorAnchorRef = useRef<HTMLParagraphElement>(null);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<PairingImportPreview | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function showError(message: string) {
    setError(message);
    requestAnimationFrame(() => {
      errorAnchorRef.current?.scrollIntoView({ block: "nearest" });
    });
  }

  async function runPreview() {
    setBusy("preview");
    setError(null);
    setApplyResult(null);
    try {
      const res = await fetch("/api/professions/officer/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, commit: false }),
      });
      const json = (await res.json()) as {
        error?: string;
        preview?: PairingImportPreview;
      };
      if (!res.ok) {
        showError(json.error ?? t("previewFailed"));
        return;
      }
      setPreview(json.preview ?? null);
    } catch {
      showError(t("previewFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function runApply() {
    setBusy("apply");
    setError(null);
    try {
      const res = await fetch("/api/professions/officer/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, commit: true }),
      });
      const json = (await res.json()) as ApplyResult & { error?: string };
      if (!res.ok) {
        showError(json.error ?? t("applyFailed"));
        return;
      }
      setApplyResult({
        assigned: json.assigned,
        skipped: json.skipped,
        failed: json.failed,
        errors: json.errors ?? [],
      });
      setPreview(null);
      onApplied();
    } catch {
      showError(t("applyFailed"));
    } finally {
      setBusy(null);
    }
  }

  function clearAll() {
    setText("");
    setPreview(null);
    setApplyResult(null);
    setError(null);
  }

  return (
    <section className="space-y-3" data-testid="profession-pairing-import">
      <div>
        <h2 className="text-sm font-semibold text-hq-fg">{t("title")}</h2>
        <p className="mt-1 text-sm text-hq-fg-muted">{t("desc")}</p>
        <p className="mt-1 font-mono text-xs text-hq-fg-muted">{t("formatHint")}</p>
      </div>

      <form
        className="space-y-3"
        onSubmit={(event) => {
          preventDefaultFormSubmit(event);
          void runPreview();
        }}
      >
        <textarea
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setPreview(null);
            setApplyResult(null);
          }}
          onKeyDown={(event) =>
            handleTextareaEnterSubmit(event, () => void runPreview())
          }
          enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
          placeholder={t("placeholder")}
          rows={6}
          className="w-full rounded-lg border border-hq-border bg-hq-surface px-3 py-2 font-mono text-sm text-hq-fg"
          data-testid="profession-pairing-import-paste"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={busy !== null || !text.trim()}>
            {busy === "preview" ? t("previewing") : t("preview")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy !== null || !preview || preview.commitCount === 0}
            onClick={() => void runApply()}
          >
            {busy === "apply" ? t("applying") : t("apply")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={clearAll}>
            {t("clear")}
          </Button>
        </div>
      </form>

      {error ? (
        <p ref={errorAnchorRef} className="text-xs text-hq-danger">
          {error}
        </p>
      ) : (
        <p ref={errorAnchorRef} className="sr-only" />
      )}

      {applyResult ? (
        <div className="space-y-1">
          <p
            className={`text-sm ${
              applyResult.failed > 0 ? "text-hq-warning" : "text-hq-success"
            }`}
          >
            {t("applied", {
              assigned: applyResult.assigned,
              skipped: applyResult.skipped,
              failCount: applyResult.failed,
            })}
          </p>
          {applyResult.failed > 0 && applyResult.errors.length > 0 ? (
            <ul className="list-inside list-disc text-xs text-hq-danger">
              {applyResult.errors.map((message, index) => (
                <li key={`${index}-${message}`}>{message}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {preview ? (
        <div className="overflow-hidden rounded-lg border border-hq-border">
          {preview.lines.length === 0 ? (
            <p className="px-4 py-3 text-sm text-hq-fg-muted">{t("empty")}</p>
          ) : (
            <ul className="divide-y divide-hq-border">
              {preview.lines.map((line) => (
                <li key={`${line.lineNumber}-${line.raw}`} className="space-y-1 px-4 py-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium text-hq-fg">
                      {line.wl.matchedName &&
                      line.wl.matchedName !== line.wl.raw
                        ? t("matchedHint", {
                            pasted: line.wl.raw,
                            matched: line.wl.matchedName,
                          })
                        : (line.wl.matchedName ?? line.wl.raw)}
                    </span>
                    <span className={`text-xs ${statusTone(line.wl.status)}`}>
                      {t(`wlStatus.${line.wl.status}`)}
                    </span>
                  </div>
                  {line.engineers.length > 0 ? (
                    <ul className="space-y-0.5 pl-3">
                      {line.engineers.map((eng, index) => (
                        <li
                          key={`${line.lineNumber}-${index}-${eng.raw}`}
                          className="flex flex-wrap gap-2 text-sm"
                        >
                          <span className="text-hq-fg">
                            {eng.matchedName && eng.matchedName !== eng.raw
                              ? t("matchedHint", {
                                  pasted: eng.raw,
                                  matched: eng.matchedName,
                                })
                              : (eng.matchedName ?? eng.raw)}
                          </span>
                          <span className={`text-xs ${statusTone(eng.status)}`}>
                            {t(`engStatus.${eng.status}`)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
