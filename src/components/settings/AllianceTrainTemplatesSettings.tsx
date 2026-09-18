"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { TemplateWeekShapeStrip } from "@/components/trains/TemplateWeekShapeStrip";
import { TrainRuleTemplateEditor } from "@/components/settings/TrainRuleTemplateEditor";
import { conductorRuleLabelKey } from "@/lib/trains/rules/catalog.shared";
import { DAY_RULE_PALETTE, ruleForPaletteSelection, defaultScopeForPaletteId } from "@/lib/trains/rules/palette.shared";
import { PRESET_WEEK_RULES } from "@/lib/trains/rules/presets.shared";
import type { TemplateWeekRules } from "@/lib/trains/rules/template-days.shared";

type RuleTemplate = {
  id: string;
  allianceId: string | null;
  presetKey: string | null;
  name: string;
  description: string | null;
  days: TemplateWeekRules;
  isPreset: boolean;
  archived: boolean;
  shareCodeHint: string | null;
};

type EditorState =
  | { mode: "create"; name: string; description: string; days: TemplateWeekRules }
  | {
      mode: "edit";
      templateId: string;
      name: string;
      description: string;
      days: TemplateWeekRules;
    };

/**
 * Week template manager.
 *
 * Presets are read-only: an alliance can hide one or copy it into an editable
 * template, but never rewrite a row other alliances share. Alliance templates
 * archive rather than delete, so days already painted from them keep
 * resolving.
 */
export function AllianceTrainTemplatesSettings({
  leadDays = 0,
}: {
  leadDays?: number;
}) {
  const t = useTranslations("settings.trainTemplates");
  const tTrains = useTranslations("trains");
  const tRules = useTranslations("trains.rules");

  const [templates, setTemplates] = useState<RuleTemplate[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editorBusy, setEditorBusy] = useState(false);
  /** Plaintext share code, shown once after create/rotate. */
  const [revealedCode, setRevealedCode] = useState<{
    templateId: string;
    code: string;
  } | null>(null);
  const [importCode, setImportCode] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);

  const ruleTextLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const entry of DAY_RULE_PALETTE) {
      const key = conductorRuleLabelKey(
        ruleForPaletteSelection(entry.id, defaultScopeForPaletteId(entry.id)),
      );
      labels[key] = tRules(key);
    }
    for (const key of ["vsTop1", "vsTopN", "vrTopN"] as const) {
      labels[key] = tRules(key);
    }
    return labels;
  }, [tRules]);

  const load = useCallback(
    async (signal?: { cancelled: boolean }) => {
      try {
        const res = await fetch("/api/trains/rule-templates");
        const body = (await res.json()) as {
          templates?: RuleTemplate[];
          canManage?: boolean;
          error?: string;
        };
        if (signal?.cancelled) return;
        if (!res.ok) {
          setError(body.error ?? t("loadFailed"));
          return;
        }
        setTemplates(body.templates ?? []);
        setCanManage(body.canManage === true);
        setError(null);
      } catch {
        if (!signal?.cancelled) setError(t("loadFailed"));
      } finally {
        if (!signal?.cancelled) setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    const signal = { cancelled: false };
    void (async () => {
      await load(signal);
    })();
    return () => {
      signal.cancelled = true;
    };
  }, [load]);

  const templateName = useCallback(
    (template: RuleTemplate) => {
      if (!template.presetKey) return template.name;
      const key = `templates.${template.presetKey}` as const;
      return tTrains.has(key) ? tTrains(key) : template.name;
    },
    [tTrains],
  );

  const visible = templates.filter(
    (template) => showArchived || !template.archived,
  );

  async function setArchived(template: RuleTemplate, archived: boolean) {
    setBusyId(template.id);
    setError(null);
    try {
      const res = await fetch(`/api/trains/rule-templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? t("saveFailed"));
        return;
      }
      await load();
    } catch {
      setError(t("saveFailed"));
    } finally {
      setBusyId(null);
    }
  }

  async function share(template: RuleTemplate, enable: boolean) {
    setBusyId(template.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/trains/rule-templates/${template.id}/share`,
        { method: enable ? "POST" : "DELETE" },
      );
      const body = (await res.json()) as { code?: string; error?: string };
      if (!res.ok) {
        setError(body.error ?? t("saveFailed"));
        return;
      }
      setRevealedCode(
        enable && body.code ? { templateId: template.id, code: body.code } : null,
      );
      await load();
    } catch {
      setError(t("saveFailed"));
    } finally {
      setBusyId(null);
    }
  }

  async function importTemplate() {
    const code = importCode.trim();
    if (!code) return;
    setImportBusy(true);
    setImportError(null);
    setImportNotice(null);
    try {
      const res = await fetch("/api/trains/rule-templates/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = (await res.json()) as {
        template?: { name: string };
        warnings?: Array<{ weekday: string }>;
        error?: string;
      };
      if (!res.ok) {
        setImportError(body.error ?? t("importFailed"));
        return;
      }
      setImportCode("");
      // Warnings are computed against *our* lead time, so an import that was
      // sound for the author can still need a look here.
      setImportNotice(
        body.warnings?.length
          ? t("importedWithWarnings", { count: body.warnings.length })
          : t("imported"),
      );
      await load();
    } catch {
      setImportError(t("importFailed"));
    } finally {
      setImportBusy(false);
    }
  }

  async function saveEditor(input: {
    name: string;
    description: string;
    days: TemplateWeekRules;
  }) {
    if (!editor) return;
    setEditorBusy(true);
    setEditorError(null);
    try {
      const res =
        editor.mode === "create"
          ? await fetch("/api/trains/rule-templates", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: input.name,
                description: input.description || null,
                days: input.days,
              }),
            })
          : await fetch(`/api/trains/rule-templates/${editor.templateId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: input.name,
                description: input.description || null,
                days: input.days,
              }),
            });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setEditorError(body.error ?? t("saveFailed"));
        return;
      }
      setEditor(null);
      await load();
    } catch {
      setEditorError(t("saveFailed"));
    } finally {
      setEditorBusy(false);
    }
  }

  return (
    <section
      className="rounded-2xl border border-hq-border bg-hq-surface p-6"
      data-testid="trains-template-settings"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-hq-fg">
            {t("sectionTitle")}
          </h2>
          <p className="mt-1 text-sm text-hq-fg-muted">{t("sectionBody")}</p>
        </div>
        {canManage ? (
          <button
            type="button"
            data-testid="trains-template-create"
            onClick={() => {
              setEditorError(null);
              setEditor({
                mode: "create",
                name: "",
                description: "",
                days: PRESET_WEEK_RULES.custom,
              });
            }}
            className="rounded-lg bg-cyan-500 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-400"
          >
            {t("create")}
          </button>
        ) : null}
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-hq-fg-muted">{t("loading")}</p>
      ) : (
        <>
          <label className="mt-4 flex items-center gap-2 text-sm text-hq-fg-muted">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
              data-testid="trains-template-show-archived"
            />
            {t("showArchived")}
          </label>

          <ul className="mt-3 space-y-3">
            {visible.map((template) => (
              <li
                key={template.id}
                data-testid={`trains-template-row-${template.presetKey ?? template.id}`}
                className={`rounded-xl border border-hq-border p-3 ${
                  template.archived ? "opacity-60" : ""
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium text-hq-fg">
                      <span className="truncate">{templateName(template)}</span>
                      {template.isPreset ? (
                        <span className="shrink-0 rounded border border-hq-border px-1 text-[10px] uppercase text-hq-fg-muted">
                          {t("presetBadge")}
                        </span>
                      ) : null}
                      {template.archived ? (
                        <span className="shrink-0 rounded border border-hq-border px-1 text-[10px] uppercase text-hq-fg-muted">
                          {t("archivedBadge")}
                        </span>
                      ) : null}
                    </p>
                    {template.description ? (
                      <p className="mt-0.5 text-xs text-hq-fg-muted">
                        {template.description}
                      </p>
                    ) : null}
                  </div>

                  {canManage ? (
                    <div className="flex shrink-0 flex-wrap gap-1.5">
                      {template.isPreset ? null : (
                        <button
                          type="button"
                          disabled={busyId === template.id}
                          data-testid={`trains-template-edit-${template.id}`}
                          onClick={() => {
                            setEditorError(null);
                            setEditor({
                              mode: "edit",
                              templateId: template.id,
                              name: template.name,
                              description: template.description ?? "",
                              days: template.days,
                            });
                          }}
                          className="rounded-md border border-hq-border px-2 py-1 text-xs font-medium text-hq-fg hover:bg-hq-canvas disabled:opacity-50"
                        >
                          {t("edit")}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busyId === template.id}
                        data-testid={`trains-template-copy-${template.presetKey ?? template.id}`}
                        onClick={() => {
                          setEditorError(null);
                          setEditor({
                            mode: "create",
                            name: t("copyName", {
                              name: templateName(template),
                            }),
                            description: template.description ?? "",
                            days: template.days,
                          });
                        }}
                        className="rounded-md border border-hq-border px-2 py-1 text-xs font-medium text-hq-fg hover:bg-hq-canvas disabled:opacity-50"
                      >
                        {t("copy")}
                      </button>
                      {template.isPreset ? null : (
                        <button
                          type="button"
                          disabled={busyId === template.id}
                          data-testid={`trains-template-share-${template.id}`}
                          onClick={() =>
                            void share(template, template.shareCodeHint == null)
                          }
                          className="rounded-md border border-hq-border px-2 py-1 text-xs font-medium text-hq-fg hover:bg-hq-canvas disabled:opacity-50"
                        >
                          {template.shareCodeHint
                            ? t("stopSharing")
                            : t("share")}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busyId === template.id}
                        data-testid={`trains-template-archive-${template.presetKey ?? template.id}`}
                        onClick={() =>
                          void setArchived(template, !template.archived)
                        }
                        className="rounded-md border border-hq-border px-2 py-1 text-xs font-medium text-hq-fg hover:bg-hq-canvas disabled:opacity-50"
                      >
                        {template.archived ? t("restore") : t("archive")}
                      </button>
                    </div>
                  ) : null}
                </div>

                {revealedCode?.templateId === template.id ? (
                  <p
                    className="mt-2 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2 py-1.5 text-xs text-hq-fg"
                    data-testid={`trains-template-share-code-${template.id}`}
                  >
                    {t("shareCodeOnce")}{" "}
                    <code className="font-mono font-semibold">
                      {revealedCode.code}
                    </code>
                  </p>
                ) : template.shareCodeHint ? (
                  <p className="mt-2 text-xs text-hq-fg-muted">
                    {t("sharedAs", { hint: template.shareCodeHint })}
                  </p>
                ) : null}

                <div className="mt-3">
                  <TemplateWeekShapeStrip
                    days={template.days}
                    ruleTextLabels={ruleTextLabels}
                  />
                </div>
              </li>
            ))}
          </ul>

          {error ? (
            <p
              className="mt-3 text-sm text-hq-danger"
              data-testid="trains-template-settings-error"
            >
              {error}
            </p>
          ) : null}

          {canManage ? (
            <div className="mt-5 border-t border-hq-border pt-4">
              <p className="text-sm font-medium text-hq-fg">
                {t("importTitle")}
              </p>
              <p className="mt-0.5 text-xs text-hq-fg-muted">
                {t("importBody")}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <input
                  value={importCode}
                  onChange={(event) => setImportCode(event.target.value)}
                  placeholder={t("importPlaceholder")}
                  maxLength={32}
                  disabled={importBusy}
                  data-testid="trains-template-import-code"
                  className="min-w-0 flex-1 rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 font-mono text-sm uppercase text-hq-fg disabled:opacity-50"
                />
                <button
                  type="button"
                  disabled={importBusy || importCode.trim().length === 0}
                  data-testid="trains-template-import-submit"
                  onClick={() => void importTemplate()}
                  className="rounded-lg border border-hq-border px-3 py-2 text-sm font-medium text-hq-fg hover:bg-hq-canvas disabled:opacity-50"
                >
                  {importBusy ? t("importing") : t("import")}
                </button>
              </div>
              {importError ? (
                <p
                  className="mt-2 text-sm text-hq-danger"
                  data-testid="trains-template-import-error"
                >
                  {importError}
                </p>
              ) : null}
              {importNotice ? (
                <p
                  className="mt-2 text-sm text-hq-fg-muted"
                  data-testid="trains-template-import-notice"
                >
                  {importNotice}
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {editor ? (
        <TrainRuleTemplateEditor
          key={editor.mode === "edit" ? editor.templateId : "create"}
          open
          initialName={editor.name}
          initialDescription={editor.description}
          initialDays={editor.days}
          leadDays={leadDays}
          busy={editorBusy}
          error={editorError}
          onClose={() => setEditor(null)}
          onSave={(input) => void saveEditor(input)}
        />
      ) : null}
    </section>
  );
}
