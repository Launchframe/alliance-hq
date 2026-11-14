"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";
import { Dialog } from "@/components/ui/dialog";
import type {
  ScoreboardAshedNameSuggestion,
  ScoreboardMemberActionRowInput,
} from "@/lib/video/scoreboard-member-actions.shared";
import { trimScoreboardConfirmedName } from "@/lib/video/scoreboard-member-actions.shared";

export type ScoreboardMemberConfirmDraft = {
  id: string;
  ocrName: string;
  currentMemberName?: string | null;
};

type PreviewRow = {
  id: string;
  confirmedName: string;
  exact: ScoreboardAshedNameSuggestion | null;
  suggestions: ScoreboardAshedNameSuggestion[];
};

type SuggestionChoice = {
  bindAshedMemberId: string;
  suggestedName: string;
  nameOverride: boolean;
};

type Props = {
  open: boolean;
  action: "create" | "rename";
  drafts: ScoreboardMemberConfirmDraft[];
  busy: boolean;
  jobId: string;
  onOpenChange: (open: boolean) => void;
  onCommitted: (result: {
    members: Array<{
      id: string;
      current_name: string;
      previous_names?: string[];
    }>;
    rows: Array<{
      id: string;
      memberId: string;
      memberName: string;
      matchMethod: string;
      matchConfidence: number;
    }>;
  }) => void;
  onError: (message: string, connectUrl?: string | null) => void;
};

function initialNamesFromDrafts(
  drafts: ScoreboardMemberConfirmDraft[],
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const draft of drafts) {
    next[draft.id] = draft.ocrName;
  }
  return next;
}

export function ScoreboardMemberConfirmDialog({
  open,
  action,
  drafts,
  busy,
  jobId,
  onOpenChange,
  onCommitted,
  onError,
}: Props) {
  const t = useTranslations("videoReview");
  const tc = useTranslations("common");
  const tVp = useTranslations("vsPerformance");
  // Parent remounts via key when drafts/action change so state resets cleanly.
  const [names, setNames] = useState(() => initialNamesFromDrafts(drafts));
  const [step, setStep] = useState<"edit" | "suggest">("edit");
  const [choices, setChoices] = useState<Record<string, SuggestionChoice>>({});
  const [pendingSuggestions, setPendingSuggestions] = useState<
    Array<{
      id: string;
      confirmedName: string;
      suggestion: ScoreboardAshedNameSuggestion;
    }>
  >([]);
  const [pendingAutoRows, setPendingAutoRows] = useState<
    ScoreboardMemberActionRowInput[]
  >([]);
  const [localBusy, setLocalBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const title = useMemo(() => {
    const count = drafts.length;
    if (action === "create") {
      return count === 1
        ? t("confirmCreateTitle")
        : t("confirmCreateTitleBulk", { count });
    }
    return count === 1
      ? t("confirmRenameTitle")
      : t("confirmRenameTitleBulk", { count });
  }, [action, drafts.length, t]);

  const submitting = busy || localBusy;
  const canSubmitEdit = drafts.every((draft) =>
    Boolean(trimScoreboardConfirmedName(names[draft.id] ?? "")),
  );
  const canSubmitSuggest = pendingSuggestions.every((row) =>
    Boolean(choices[row.id]?.bindAshedMemberId),
  );

  async function commitRows(rows: ScoreboardMemberActionRowInput[]) {
    setLocalBusy(true);
    setLocalError(null);
    try {
      const res = await fetch(
        `/api/tools/video-upload/${jobId}/scoreboard-members`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, rows }),
        },
      );
      const data = (await res.json()) as {
        error?: string;
        connectUrl?: string;
        members?: Array<{
          id: string;
          current_name: string;
          previous_names?: string[];
        }>;
        rows?: Array<{
          id: string;
          memberId: string;
          memberName: string;
          matchMethod: string;
          matchConfidence: number;
        }>;
      };
      if (!res.ok) {
        const message = data.error ?? tc("uploadFailed");
        setLocalError(message);
        onError(message, data.connectUrl ?? null);
        return;
      }
      onCommitted({
        members: data.members ?? [],
        rows: data.rows ?? [],
      });
      onOpenChange(false);
    } catch {
      const message = tc("uploadFailed");
      setLocalError(message);
      onError(message);
    } finally {
      setLocalBusy(false);
    }
  }

  async function handleContinue() {
    if (!canSubmitEdit || submitting) return;
    const rows: ScoreboardMemberActionRowInput[] = drafts.map((draft) => ({
      id: draft.id,
      confirmedName: trimScoreboardConfirmedName(names[draft.id] ?? ""),
    }));

    if (action === "rename") {
      await commitRows(rows);
      return;
    }

    setLocalBusy(true);
    setLocalError(null);
    let autoRows: ScoreboardMemberActionRowInput[] = [];
    const needsChoice: Array<{
      id: string;
      confirmedName: string;
      suggestion: ScoreboardAshedNameSuggestion;
    }> = [];
    try {
      const res = await fetch(
        `/api/tools/video-upload/${jobId}/scoreboard-members/preview`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows }),
        },
      );
      const data = (await res.json()) as {
        error?: string;
        connectUrl?: string;
        rows?: PreviewRow[];
      };
      if (!res.ok) {
        const message = data.error ?? tc("uploadFailed");
        setLocalError(message);
        onError(message, data.connectUrl ?? null);
        return;
      }

      const autoBindExact: ScoreboardMemberActionRowInput[] = [];
      const plainCreate: ScoreboardMemberActionRowInput[] = [];

      for (const row of data.rows ?? []) {
        if (row.exact) {
          autoBindExact.push({
            id: row.id,
            confirmedName: row.confirmedName,
            bindAshedMemberId: row.exact.id,
            nameOverride: false,
          });
          continue;
        }
        const top = row.suggestions[0];
        if (top) {
          needsChoice.push({
            id: row.id,
            confirmedName: row.confirmedName,
            suggestion: top,
          });
          continue;
        }
        plainCreate.push({
          id: row.id,
          confirmedName: row.confirmedName,
        });
      }
      autoRows = [...autoBindExact, ...plainCreate];

      if (needsChoice.length > 0) {
        setPendingAutoRows(autoRows);
        setPendingSuggestions(needsChoice);
        setChoices(
          Object.fromEntries(
            needsChoice.map((row) => [
              row.id,
              {
                bindAshedMemberId: row.suggestion.id,
                suggestedName: row.suggestion.name,
                nameOverride: false,
              } satisfies SuggestionChoice,
            ]),
          ),
        );
        setStep("suggest");
        return;
      }
    } catch {
      const message = tc("uploadFailed");
      setLocalError(message);
      onError(message);
      return;
    } finally {
      setLocalBusy(false);
    }

    await commitRows(autoRows);
  }

  async function handleSuggestConfirm() {
    if (!canSubmitSuggest || submitting) return;
    const choiceRows: ScoreboardMemberActionRowInput[] = pendingSuggestions.map(
      (row) => {
        const choice = choices[row.id]!;
        return {
          id: row.id,
          confirmedName: row.confirmedName,
          bindAshedMemberId: choice.bindAshedMemberId,
          nameOverride: choice.nameOverride,
        };
      },
    );
    await commitRows([...pendingAutoRows, ...choiceRows]);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (submitting) return;
        onOpenChange(next);
      }}
      title={title}
      data-testid="scoreboard-member-confirm-dialog"
    >
      <form
        className="space-y-4 p-5"
        onSubmit={(event) => {
          preventDefaultFormSubmit(event);
          if (step === "edit") {
            void handleContinue();
          } else {
            void handleSuggestConfirm();
          }
        }}
      >
        {step === "edit" ? (
          <>
            <p className="text-sm text-hq-fg-muted">
              {action === "create"
                ? t("confirmCreateHint")
                : t("confirmRenameHint")}
            </p>
            <div className="space-y-3">
              {drafts.map((draft) => (
                <label key={draft.id} className="block text-sm">
                  {action === "rename" ? (
                    <>
                      <span className="mb-1 block text-hq-fg-muted">
                        {t("confirmCurrentNameLabel")}
                      </span>
                      <span className="mb-2 block font-medium text-hq-fg">
                        {draft.currentMemberName ?? "—"}
                      </span>
                      <span className="mb-1 block text-hq-fg-muted">
                        {t("confirmNewNameLabel")}
                      </span>
                    </>
                  ) : (
                    <span className="mb-1 block text-hq-fg-muted">
                      {t("confirmNameLabel")}
                    </span>
                  )}
                  <input
                    value={names[draft.id] ?? ""}
                    onChange={(event) =>
                      setNames((prev) => ({
                        ...prev,
                        [draft.id]: event.target.value,
                      }))
                    }
                    enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
                    disabled={submitting}
                    className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-hq-fg"
                  />
                </label>
              ))}
            </div>
          </>
        ) : (
          <div className="space-y-4">
            {pendingSuggestions.map((row) => {
              const choice = choices[row.id];
              const useSuggested = choice?.nameOverride !== true;
              return (
                <div
                  key={row.id}
                  className="rounded-lg border border-hq-border bg-hq-surface-muted/40 p-3"
                >
                  <p className="text-sm font-medium text-hq-fg">
                    {t("ashedDidYouMean", { name: row.suggestion.name })}
                  </p>
                  <p className="mt-1 text-xs text-hq-fg-muted">
                    {row.confirmedName}
                  </p>
                  <div className="mt-3 flex flex-col gap-2">
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() =>
                        setChoices((prev) => ({
                          ...prev,
                          [row.id]: {
                            bindAshedMemberId: row.suggestion.id,
                            suggestedName: row.suggestion.name,
                            nameOverride: false,
                          },
                        }))
                      }
                      className={`rounded-lg border px-3 py-2 text-left text-sm ${
                        useSuggested
                          ? "border-hq-success bg-hq-success/10 text-hq-success"
                          : "border-hq-border text-hq-fg hover:bg-hq-surface-muted"
                      }`}
                    >
                      {t("ashedUseSuggested")}
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() =>
                        setChoices((prev) => ({
                          ...prev,
                          [row.id]: {
                            bindAshedMemberId: row.suggestion.id,
                            suggestedName: row.suggestion.name,
                            nameOverride: true,
                          },
                        }))
                      }
                      className={`rounded-lg border px-3 py-2 text-left text-sm ${
                        !useSuggested
                          ? "border-[#d29922] bg-[#d29922]/10 text-[#e3b341]"
                          : "border-hq-border text-hq-fg hover:bg-hq-surface-muted"
                      }`}
                    >
                      <span className="block">{t("ashedKeepTyped")}</span>
                      <span className="mt-1 block text-xs text-hq-fg-muted">
                        {t("ashedKeepTypedHint")}
                      </span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {localError ? (
          <p className="text-sm text-hq-danger" role="alert">
            {localError}
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
            className="rounded-lg border border-hq-border px-3 py-1.5 text-sm text-hq-fg hover:bg-hq-surface-muted disabled:opacity-50"
          >
            {tVp("actions.cancel")}
          </button>
          <button
            type="submit"
            disabled={
              submitting ||
              (step === "edit" ? !canSubmitEdit : !canSubmitSuggest)
            }
            className="rounded-lg border border-hq-success bg-hq-success px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {step === "edit" && action === "create"
              ? t("confirmContinue")
              : t("confirmAction")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
