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
  draft: "bg-[#21262d] text-[#8b949e] border-[#30363d]",
  active: "bg-[#3fb95020] text-[#3fb950] border-[#3fb950]",
  archived: "bg-[#21262d] text-[#484f58] border-[#21262d]",
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#e6edf3]">{t("title")}</h1>
          <p className="mt-1 text-sm text-[#8b949e]">{t("subtitle")}</p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md border border-[#30363d] bg-[#21262d] px-3 py-1.5 text-sm text-[#e6edf3] hover:border-[#58a6ff] hover:text-[#58a6ff] transition-colors"
        >
          {showForm ? t("cancel") : t("newConfig")}
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <form
          onSubmit={(e) => void handleCreate(e)}
          className="rounded-lg border border-[#30363d] bg-[#161b22] p-4 space-y-4"
        >
          <h2 className="text-sm font-semibold text-[#e6edf3]">{t("newConfig")}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("form.name")}>
              <input
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded border border-[#30363d] bg-[#0d1117] px-3 py-1.5 text-sm text-[#e6edf3] focus:border-[#58a6ff] focus:outline-none"
              />
            </Field>
            <Field label={t("form.passKey")} help={t("form.passKeyHelp")}>
              <input
                required
                placeholder="scene_0.33"
                value={form.passKey}
                onChange={(e) => setForm((f) => ({ ...f, passKey: e.target.value }))}
                className="w-full rounded border border-[#30363d] bg-[#0d1117] px-3 py-1.5 text-sm font-mono text-[#e6edf3] focus:border-[#58a6ff] focus:outline-none"
              />
            </Field>
          </div>
          <Field label={t("form.description")}>
            <input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="w-full rounded border border-[#30363d] bg-[#0d1117] px-3 py-1.5 text-sm text-[#e6edf3] focus:border-[#58a6ff] focus:outline-none"
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label={t("form.mode")} help={t("form.modeHelp")}>
              <select
                value={form.mode}
                onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value as "scene" | "fps" }))}
                className="w-full rounded border border-[#30363d] bg-[#0d1117] px-3 py-1.5 text-sm text-[#e6edf3] focus:border-[#58a6ff] focus:outline-none"
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
                  className="w-full rounded border border-[#30363d] bg-[#0d1117] px-3 py-1.5 text-sm text-[#e6edf3] focus:border-[#58a6ff] focus:outline-none"
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
                className="w-full rounded border border-[#30363d] bg-[#0d1117] px-3 py-1.5 text-sm text-[#e6edf3] focus:border-[#58a6ff] focus:outline-none"
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
              className="w-full rounded border border-[#30363d] bg-[#0d1117] px-3 py-1.5 text-sm text-[#e6edf3] focus:border-[#58a6ff] focus:outline-none"
            />
          </Field>
          {error && <p className="text-sm text-[#f85149]">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-[#238636] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#2ea043] disabled:opacity-50 transition-colors"
            >
              {saving ? t("saving") : t("create")}
            </button>
          </div>
        </form>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <label className="text-xs text-[#8b949e]">{t("statusFilter")}</label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs text-[#e6edf3] focus:border-[#58a6ff] focus:outline-none"
        >
          <option value="">{t("allStatuses")}</option>
          <option value="draft">draft</option>
          <option value="active">active</option>
          <option value="archived">archived</option>
        </select>
      </div>

      {/* Error / loading */}
      {error && !showForm && <p className="text-sm text-[#f85149]">{error}</p>}
      {patchError && <p className="text-sm text-[#f85149]">{patchError}</p>}
      {loading && <p className="text-sm text-[#8b949e]">{t("loading")}</p>}

      {/* Table */}
      {!loading && (
        <div className="overflow-x-auto rounded-lg border border-[#30363d]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#30363d] bg-[#161b22] text-[#8b949e] text-xs uppercase tracking-wide">
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
                  <td colSpan={5} className="px-4 py-6 text-center text-[#8b949e]">
                    {t("empty")}
                  </td>
                </tr>
              )}
              {configs.map((cfg) => (
                <tr
                  key={cfg.id}
                  className="border-b border-[#21262d] hover:bg-[#161b22] transition-colors"
                >
                  <td className="px-4 py-3 text-[#e6edf3]">
                    <div className="font-medium">{cfg.name}</div>
                    {cfg.description && (
                      <div className="text-xs text-[#8b949e] mt-0.5">{cfg.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-[#79c0ff]">
                    {cfg.passKey}
                  </td>
                  <td className="px-4 py-3 text-xs text-[#8b949e]">
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
                            className={`rounded px-2 py-0.5 text-xs border transition-colors ${s === cfg.status ? "opacity-50 cursor-default" : "hover:border-[#58a6ff] hover:text-[#58a6ff]"} ${STATUS_COLORS[s]}`}
                          >
                            {s}
                          </button>
                        ))}
                        <button
                          onClick={() => setEditingId(null)}
                          className="text-xs text-[#8b949e] hover:text-[#e6edf3]"
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
                        className="text-xs text-[#8b949e] hover:text-[#58a6ff] transition-colors"
                      >
                        {t("changeStatus")}
                      </button>
                      <Link
                        href={`/admin/experiments?configId=${cfg.id}`}
                        className="text-xs text-[#8b949e] hover:text-[#58a6ff] transition-colors"
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
      <span className="mb-1 block text-xs text-[#8b949e]">{label}</span>
      {children}
      {help && (
        <span className="mt-1 block text-xs text-[#484f58] leading-relaxed">{help}</span>
      )}
    </label>
  );
}
