"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  handleTextareaEnterSubmit,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";
import { renderConductorInviteTemplate } from "@/lib/trains/conductor-invite.shared";

type Props = {
  conductorNickname: string;
  vipName: string;
  conductorPowerM: number | null;
  vipPowerM: number | null;
  savedTemplate: string | null;
  canEdit: boolean;
  onSaveTemplate: (template: string | null) => Promise<void>;
};

export function ConductorInviteMessage({
  conductorNickname,
  vipName,
  conductorPowerM,
  vipPowerM,
  savedTemplate,
  canEdit,
  onSaveTemplate,
}: Props) {
  const t = useTranslations("trains.guidedFlow");
  const tCommon = useTranslations("common");
  const tTemplates = useTranslations("trains.templates");
  const tSettings = useTranslations("trains.userSettings");
  // t.raw: the template is not ICU. Formatting it would throw on the role token.
  const defaultTemplate = String(t.raw("conductorInvite.defaultTemplate"));
  const activeTemplate = savedTemplate?.trim() || defaultTemplate;
  const message = renderConductorInviteTemplate(activeTemplate, {
    conductorNickname,
    vipName,
    conductorPowerM,
    vipPowerM,
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(activeTemplate);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function copyMessage() {
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setCopyError(true);
    }
  }

  async function saveTemplate() {
    setSaving(true);
    setSaveError(null);
    const trimmed = draft.trim();
    const next = !trimmed || trimmed === defaultTemplate ? null : trimmed;
    try {
      await onSaveTemplate(next);
      setEditing(false);
    } catch (error) {
      setSaveError(
        error instanceof Error && error.message
          ? error.message
          : tSettings("saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-hq-border bg-hq-surface px-3 py-2"
      data-testid="trains-conductor-invite"
    >
      <p className="whitespace-pre-wrap text-sm text-hq-fg">{message}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void copyMessage()}
          data-testid="trains-conductor-invite-copy"
          className="inline-flex items-center justify-center rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-400"
        >
          {copied ? tCommon("copied") : tCommon("copy")}
        </button>
        {canEdit ? (
          <button
            type="button"
            onClick={() => {
              setDraft(activeTemplate);
              setSaveError(null);
              setEditing((open) => !open);
            }}
            className="text-xs font-medium text-cyan-600 hover:underline dark:text-cyan-300"
          >
            {tTemplates("edit")}
          </button>
        ) : null}
      </div>
      {copyError ? (
        <p className="text-xs text-hq-danger" role="alert">
          {tCommon("copyFailed")}
        </p>
      ) : null}
      {editing && canEdit ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            preventDefaultFormSubmit(event);
            void saveTemplate();
          }}
        >
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) =>
              handleTextareaEnterSubmit(event, () => void saveTemplate())
            }
            enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
            maxLength={500}
            rows={4}
            aria-label={tTemplates("edit")}
            data-testid="trains-conductor-invite-template"
            className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
          />
          <button
            type="submit"
            disabled={saving}
            className="inline-flex w-full items-center justify-center rounded-lg border border-hq-border bg-hq-canvas px-3 py-1.5 text-xs font-medium text-hq-fg hover:bg-hq-surface disabled:opacity-50 sm:w-auto"
          >
            {tTemplates("save")}
          </button>
          {saveError ? (
            <p className="text-xs text-hq-danger" role="alert">
              {saveError}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
