"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  handleTextareaEnterSubmit,
} from "@/lib/client/form-enter-submit.shared";
import type { ExtractionConfig } from "@/lib/db/schema";

type ParseConfig = {
  id: string;
  name: string;
  passKey: string;
  description: string | null;
  configJson: ExtractionConfig;
  status: string;
  notes: string | null;
  createdAt: string;
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-hq-surface-muted text-hq-fg-muted border-hq-border",
  active: "bg-[#3fb95020] text-hq-green border-hq-green",
  archived: "bg-hq-surface-muted text-[#484f58] border-hq-surface-muted",
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLORS[status] ?? STATUS_COLORS.draft;
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

function configSummary(cfg: ExtractionConfig): string {
  if (cfg.mode === "scene") {
    return `scene detection @ ${cfg.sceneThreshold ?? "?"}`;
  }
  return `fps @ ${cfg.sampleFps ?? "?"}`;
}

const EMPTY_FORM = {
  name: "",
  passKey: "",
  description: "",
  mode: "scene" as "scene" | "fps",
  sceneThreshold: "0.25",
  sampleFps: "1",
  notes: "",
};

export function AdminParseConfigsView() {
  const t = useTranslations("admin.parseConfigsPage");
  const [configs, setConfigs] = useState<ParseConfig[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [patchError, setPatchError] = useState<string | null>(null);

  const loadConfigs = useCallback(async (status: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      const res = await fetch(`/api/admin/parse-configs?${params}`);
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { configs: ParseConfig[] };
      setConfigs(data.configs);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void (async () => {
      try {
        await loadConfigs(statusFilter);
      } catch {
        // handled inside loadConfigs
      }
    })();
  }, [loadConfigs, statusFilter]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const configJson: ExtractionConfig =
        form.mode === "scene"
          ? { mode: "scene", sceneThreshold: parseFloat(form.sceneThreshold), sampleFps: parseFloat(form.sampleFps) }
          : { mode: "fps", sampleFps: parseFloat(form.sampleFps) };

      const res = await fetch("/api/admin/parse-configs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          passKey: form.passKey,
          description: form.description || null,
          configJson,
          notes: form.notes || null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setForm(EMPTY_FORM);
      setShowForm(false);
      await loadConfigs(statusFilter);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handlePatch(id: string, patch: Record<string, unknown>) {
    setPatchError(null);
    try {
      const res = await fetch(`/api/admin/parse-configs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(await res.text());
      await loadConfigs(statusFilter);
    } catch (err) {
      setPatchError(err instanceof Error ? err.message : t("saveFailed"));
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-hq-fg">{t("title")}</h1>
          <p className="mt-1 text-sm text-hq-fg-muted">{t("subtitle")}</p>
          <p className="mt-2 text-sm">
            <Link
              href="/admin/guides/video-pipeline"
              className="text-hq-accent hover:underline"
            >
              Video pipeline configs and experiments guide
            </Link>
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="shrink-0 rounded-md border border-hq-border bg-hq-surface-muted px-3 py-1.5 text-sm text-hq-fg hover:border-hq-accent hover:text-hq-accent transition-colors"
        >
          {showForm ? t("cancel") : t("newConfig")}
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <form
          onSubmit={(e) => void handleCreate(e)}
          className="rounded-lg border border-hq-border bg-hq-surface p-4 space-y-4"
        >
          <h2 className="text-sm font-semibold text-hq-fg">{t("newConfig")}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("form.name")}>
              <input
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded border border-hq-border bg-hq-canvas px-3 py-1.5 text-sm text-hq-fg focus:border-hq-accent focus:outline-none"
              />
            </Field>
            <Field label={t("form.passKey")} help={t("form.passKeyHelp")}>
              <input
                required
                placeholder="scene_0.33"
                value={form.passKey}
                onChange={(e) => setForm((f) => ({ ...f, passKey: e.target.value }))}
                className="w-full rounded border border-hq-border bg-hq-canvas px-3 py-1.5 text-sm font-mono text-hq-fg focus:border-hq-accent focus:outline-none"
              />
            </Field>
          </div>
          <Field label={t("form.description")}>
            <input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="w-full rounded border border-hq-border bg-hq-canvas px-3 py-1.5 text-sm text-hq-fg focus:border-hq-accent focus:outline-none"
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label={t("form.mode")} help={t("form.modeHelp")}>
              <select
                value={form.mode}
                onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value as "scene" | "fps" }))}
                className="w-full rounded border border-hq-border bg-hq-canvas px-3 py-1.5 text-sm text-hq-fg focus:border-hq-accent focus:outline-none"
              >
                <option value="scene">scene</option>
                <option value="fps">fps</option>
              </select>
            </Field>
            {form.mode === "scene" && (
              <Field label={t("form.sceneThreshold")} help={t("form.sceneThresholdHelp")}>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max="1"
                  value={form.sceneThreshold}
                  onChange={(e) => setForm((f) => ({ ...f, sceneThreshold: e.target.value }))}
                  className="w-full rounded border border-hq-border bg-hq-canvas px-3 py-1.5 text-sm text-hq-fg focus:border-hq-accent focus:outline-none"
                />
              </Field>
            )}
            <Field label={t("form.sampleFps")} help={t("form.sampleFpsHelp")}>
              <input
                type="number"
                step="0.5"
                min="0.5"
                value={form.sampleFps}
                onChange={(e) => setForm((f) => ({ ...f, sampleFps: e.target.value }))}
                className="w-full rounded border border-hq-border bg-hq-canvas px-3 py-1.5 text-sm text-hq-fg focus:border-hq-accent focus:outline-none"
              />
            </Field>
          </div>
          <Field label={t("form.notes")}>
            <textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
              onKeyDown={(e) =>
                handleTextareaEnterSubmit(e, () => {
                  e.currentTarget.form?.requestSubmit();
                })
              }
              className="w-full rounded border border-hq-border bg-hq-canvas px-3 py-1.5 text-sm text-hq-fg focus:border-hq-accent focus:outline-none"
            />
          </Field>
          {error && <p className="text-sm text-hq-danger">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-hq-success px-4 py-1.5 text-sm font-medium text-white hover:bg-hq-success-hover disabled:opacity-50 transition-colors"
            >
              {saving ? t("saving") : t("create")}
            </button>
          </div>
        </form>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <label className="text-xs text-hq-fg-muted">{t("statusFilter")}</label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded border border-hq-border bg-hq-surface px-2 py-1 text-xs text-hq-fg focus:border-hq-accent focus:outline-none"
        >
          <option value="">{t("allStatuses")}</option>
          <option value="draft">draft</option>
          <option value="active">active</option>
          <option value="archived">archived</option>
        </select>
      </div>

      {/* Error / loading */}
      {error && !showForm && <p className="text-sm text-hq-danger">{error}</p>}
      {patchError && <p className="text-sm text-hq-danger">{patchError}</p>}
      {loading && <p className="text-sm text-hq-fg-muted">{t("loading")}</p>}

      {/* Table */}
      {!loading && (
        <div className="overflow-x-auto rounded-lg border border-hq-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hq-border bg-hq-surface text-hq-fg-muted text-xs uppercase tracking-wide">
                <th className="px-4 py-2 text-left">{t("col.name")}</th>
                <th className="px-4 py-2 text-left">{t("col.passKey")}</th>
                <th className="px-4 py-2 text-left">{t("col.config")}</th>
                <th className="px-4 py-2 text-left">{t("col.status")}</th>
                <th className="px-4 py-2 text-left">{t("col.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {configs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-hq-fg-muted">
                    {t("empty")}
                  </td>
                </tr>
              )}
              {configs.map((cfg) => (
                <tr
                  key={cfg.id}
                  className="border-b border-hq-surface-muted hover:bg-hq-surface transition-colors"
                >
                  <td className="px-4 py-3 text-hq-fg">
                    <div className="font-medium">{cfg.name}</div>
                    {cfg.description && (
                      <div className="text-xs text-hq-fg-muted mt-0.5">{cfg.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-[#79c0ff]">
                    {cfg.passKey}
                  </td>
                  <td className="px-4 py-3 text-xs text-hq-fg-muted">
                    {configSummary(cfg.configJson)}
                  </td>
                  <td className="px-4 py-3">
                    {editingId === cfg.id ? (
                      <div className="flex items-center gap-2">
                        {(["draft", "active", "archived"] as const).map((s) => (
                          <button
                            key={s}
                            onClick={() => {
                              void handlePatch(cfg.id, { status: s });
                              setEditingId(null);
                            }}
                            className={`rounded px-2 py-0.5 text-xs border transition-colors ${s === cfg.status ? "opacity-50 cursor-default" : "hover:border-hq-accent hover:text-hq-accent"} ${STATUS_COLORS[s]}`}
                          >
                            {s}
                          </button>
                        ))}
                        <button
                          onClick={() => setEditingId(null)}
                          className="text-xs text-hq-fg-muted hover:text-hq-fg"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <StatusBadge status={cfg.status} />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setEditingId(editingId === cfg.id ? null : cfg.id)}
                        className="text-xs text-hq-fg-muted hover:text-hq-accent transition-colors"
                      >
                        {t("changeStatus")}
                      </button>
                      <Link
                        href={`/admin/experiments?configId=${cfg.id}`}
                        className="text-xs text-hq-fg-muted hover:text-hq-accent transition-colors"
                      >
                        {t("viewExperiments")}
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-hq-fg-muted">{label}</span>
      {children}
      {help && (
        <span className="mt-1 block text-xs text-[#484f58] leading-relaxed">{help}</span>
      )}
    </label>
  );
}
