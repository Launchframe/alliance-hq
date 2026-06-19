"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

type Campaign = {
  id: string;
  name: string;
  description: string | null;
  scoreTarget: string;
  boardKey: string | null;
  status: string;
  trafficPercent: number;
  startedAt: string | null;
  concludedAt: string | null;
  armCount: number;
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-[#21262d] text-[#8b949e] border-[#30363d]",
  active: "bg-[#3fb95020] text-[#3fb950] border-[#3fb950]",
  paused: "bg-[#d2992220] text-[#d29922] border-[#d29922]",
  concluded: "bg-[#21262d] text-[#484f58] border-[#21262d]",
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLORS[status] ?? STATUS_COLORS.draft;
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

const EMPTY_FORM = {
  name: "",
  description: "",
  hypothesis: "",
  scoreTarget: "",
  boardKey: "",
  trafficPercent: "100",
};

const INPUT_CLASS =
  "w-full rounded border border-[#30363d] bg-[#0d1117] px-3 py-1.5 text-sm text-[#e6edf3] focus:border-[#58a6ff] focus:outline-none";

export function AdminExperimentsView() {
  const t = useTranslations("admin.experimentsPage");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const loadCampaigns = useCallback(async (status: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      const res = await fetch(`/api/admin/experiments?${params}`);
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { campaigns: Campaign[] };
      setCampaigns(data.campaigns);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void (async () => {
      try {
        await loadCampaigns(statusFilter);
      } catch {
        // handled inside loadCampaigns
      }
    })();
  }, [loadCampaigns, statusFilter]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description || null,
          hypothesis: form.hypothesis || null,
          scoreTarget: form.scoreTarget,
          boardKey: form.boardKey || null,
          trafficPercent: parseInt(form.trafficPercent, 10) || 100,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setForm(EMPTY_FORM);
      setShowForm(false);
      await loadCampaigns(statusFilter);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
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
          {showForm ? t("cancel") : t("newCampaign")}
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <form
          onSubmit={(e) => void handleCreate(e)}
          className="rounded-lg border border-[#30363d] bg-[#161b22] p-4 space-y-4"
        >
          <h2 className="text-sm font-semibold text-[#e6edf3]">{t("newCampaign")}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("form.name")}>
              <input
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label={`${t("form.scoreTarget")} *`}>
              <input
                required
                placeholder="e.g. alliance_exercise, member-roster-screenshot"
                value={form.scoreTarget}
                onChange={(e) => setForm((f) => ({ ...f, scoreTarget: e.target.value }))}
                className={`${INPUT_CLASS} font-mono`}
              />
              <p className="mt-1 text-xs text-[#484f58]">
                Roster OCR: use <code className="font-mono">member-roster-screenshot</code>. Pair with a parse config of mode <code className="font-mono">roster-ocr</code>.
              </p>
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("form.boardKey")}>
              <input
                placeholder={t("form.boardKeyPlaceholder")}
                value={form.boardKey}
                onChange={(e) => setForm((f) => ({ ...f, boardKey: e.target.value }))}
                className={`${INPUT_CLASS} font-mono`}
              />
            </Field>
            <Field label={t("form.trafficPercent")}>
              <input
                type="number"
                min="1"
                max="100"
                value={form.trafficPercent}
                onChange={(e) => setForm((f) => ({ ...f, trafficPercent: e.target.value }))}
                className={INPUT_CLASS}
              />
            </Field>
          </div>
          <Field label={t("form.hypothesis")}>
            <textarea
              rows={2}
              placeholder={t("form.hypothesisPlaceholder")}
              value={form.hypothesis}
              onChange={(e) => setForm((f) => ({ ...f, hypothesis: e.target.value }))}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label={t("form.description")}>
            <textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className={INPUT_CLASS}
            />
          </Field>
          {error && <p className="text-sm text-[#f85149]">{error}</p>}
          <div className="rounded border border-[#d2992230] bg-[#d2992208] p-3 text-xs text-[#d29922]">
            {t("form.scopeWarning")}
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-[#238636] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#2ea043] disabled:opacity-50 transition-colors"
          >
            {saving ? t("saving") : t("create")}
          </button>
        </form>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <label className="text-xs text-[#8b949e]">{t("statusFilter")}</label>
        {(["", "draft", "active", "paused", "concluded"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-full border px-3 py-0.5 text-xs transition-colors ${statusFilter === s ? "border-[#58a6ff] text-[#58a6ff] bg-[#58a6ff15]" : "border-[#30363d] text-[#8b949e] hover:border-[#58a6ff] hover:text-[#58a6ff]"}`}
          >
            {s || t("all")}
          </button>
        ))}
      </div>

      {error && !showForm && <p className="text-sm text-[#f85149]">{error}</p>}
      {loading && <p className="text-sm text-[#8b949e]">{t("loading")}</p>}

      {/* Campaign list */}
      {!loading && (
        <div className="space-y-2">
          {campaigns.length === 0 && (
            <p className="text-center py-10 text-[#8b949e] text-sm">{t("empty")}</p>
          )}
          {campaigns.map((c) => (
            <Link
              key={c.id}
              href={`/admin/experiments/${c.id}`}
              className="block rounded-lg border border-[#30363d] bg-[#161b22] p-4 hover:border-[#58a6ff] transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[#e6edf3]">{c.name}</span>
                    <StatusBadge status={c.status} />
                  </div>
                  {c.description && (
                    <p className="mt-1 text-xs text-[#8b949e] truncate">{c.description}</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-[#8b949e]">
                  <span className="font-mono text-[#79c0ff]">
                    {c.scoreTarget}
                    {c.boardKey ? ` · ${c.boardKey}` : ""}
                  </span>
                  <span>{c.trafficPercent}% traffic · {c.armCount} {t("arms")}</span>
                  {c.startedAt && (
                    <span>{t("started")} {new Date(c.startedAt).toLocaleDateString()}</span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-[#8b949e]">{label}</span>
      {children}
    </label>
  );
}
