"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type ItemDef = {
  id: string;
  slug: string;
  displayName: string;
  pointsByDay: Record<string, number>;
  status: string;
  iconTemplateUrl: string | null;
  iconPhash: string | null;
  sortOrder: number;
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-hq-surface-muted text-hq-fg-muted border-hq-border",
  active: "bg-[#3fb95020] text-hq-green border-hq-green",
  retired: "bg-hq-surface-muted text-[#484f58] border-hq-surface-muted",
};

const EMPTY_FORM = {
  slug: "",
  displayName: "",
  status: "draft",
  sortOrder: "0",
  day1: "",
  day2: "",
  day3: "",
  day4: "",
  day5: "",
};

function pointsFromForm(form: typeof EMPTY_FORM): Record<string, number> {
  const out: Record<string, number> = {};
  for (let day = 1; day <= 5; day++) {
    const raw = form[`day${day}` as keyof typeof EMPTY_FORM];
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) {
      out[String(day)] = value;
    }
  }
  return out;
}

function formFromDef(def: ItemDef): typeof EMPTY_FORM {
  return {
    slug: def.slug,
    displayName: def.displayName,
    status: def.status,
    sortOrder: String(def.sortOrder),
    day1: def.pointsByDay["1"] ? String(def.pointsByDay["1"]) : "",
    day2: def.pointsByDay["2"] ? String(def.pointsByDay["2"]) : "",
    day3: def.pointsByDay["3"] ? String(def.pointsByDay["3"]) : "",
    day4: def.pointsByDay["4"] ? String(def.pointsByDay["4"]) : "",
    day5: def.pointsByDay["5"] ? String(def.pointsByDay["5"]) : "",
  };
}

export function AdminVsInventoryItemsView() {
  const t = useTranslations("admin.vsInventoryItemsPage");
  const [defs, setDefs] = useState<ItemDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [iconUploading, setIconUploading] = useState(false);

  const loadDefs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/vs-inventory-item-defs");
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { defs: ItemDef[] };
      setDefs(data.defs);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDefs();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDefs]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/vs-inventory-item-defs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: form.slug.trim(),
          displayName: form.displayName.trim(),
          status: form.status,
          sortOrder: Number(form.sortOrder) || 0,
          pointsByDay: pointsFromForm(form),
        }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? t("saveFailed"));
      }
      setShowForm(false);
      setForm(EMPTY_FORM);
      await loadDefs();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handlePatch(defId: string) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/vs-inventory-item-defs/${defId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: form.slug.trim(),
          displayName: form.displayName.trim(),
          status: form.status,
          sortOrder: Number(form.sortOrder) || 0,
          pointsByDay: pointsFromForm(form),
        }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? t("saveFailed"));
      }
      setEditingId(null);
      setForm(EMPTY_FORM);
      await loadDefs();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleIconUpload(defId: string, file: File) {
    setIconUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("icon", file);
      const res = await fetch(
        `/api/admin/vs-inventory-item-defs/${defId}/icon`,
        { method: "POST", body },
      );
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? t("iconUploadFailed"));
      }
      await loadDefs();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("iconUploadFailed"));
    } finally {
      setIconUploading(false);
    }
  }

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-6 p-4 sm:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-hq-fg">{t("title")}</h1>
        <p className="text-sm text-hq-fg-muted">{t("subtitle")}</p>
      </header>

      {error ? (
        <p className="text-sm text-hq-danger" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg border border-hq-border bg-hq-surface-muted px-4 py-2 text-sm text-hq-fg"
          onClick={() => {
            setShowForm((v) => !v);
            setEditingId(null);
            setForm(EMPTY_FORM);
          }}
        >
          {showForm ? t("cancelNew") : t("newItem")}
        </button>
      </div>

      {showForm ? (
        <form
          onSubmit={(e) => void handleCreate(e)}
          className="space-y-4 rounded-xl border border-hq-border bg-hq-surface p-4"
        >
          <h2 className="text-sm font-medium text-hq-fg">{t("newItemHeading")}</h2>
          <ItemDefFields form={form} setForm={setForm} t={t} />
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-hq-accent px-4 py-2 text-sm font-medium text-hq-accent-fg disabled:opacity-50"
          >
            {saving ? t("saving") : t("create")}
          </button>
        </form>
      ) : null}

      {loading ? (
        <p className="text-sm text-hq-fg-muted">{t("loading")}</p>
      ) : (
        <ul className="space-y-3">
          {defs.map((def) => (
            <li
              key={def.id}
              className="rounded-xl border border-hq-border bg-hq-surface p-4"
            >
              {editingId === def.id ? (
                <div className="space-y-4">
                  <ItemDefFields form={form} setForm={setForm} t={t} />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      className="rounded-lg bg-hq-accent px-4 py-2 text-sm font-medium text-hq-accent-fg"
                      onClick={() => void handlePatch(def.id)}
                    >
                      {saving ? t("saving") : t("save")}
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-hq-border px-4 py-2 text-sm text-hq-fg"
                      onClick={() => {
                        setEditingId(null);
                        setForm(EMPTY_FORM);
                      }}
                    >
                      {t("cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 gap-3">
                    {def.iconTemplateUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/admin/vs-inventory-item-defs/${def.id}/icon`}
                        alt=""
                        className="h-12 w-12 shrink-0 rounded-lg border border-hq-border bg-hq-canvas object-contain"
                      />
                    ) : (
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-dashed border-hq-border text-xs text-hq-fg-muted">
                        {t("noIcon")}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-hq-fg">{def.displayName}</p>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_COLORS[def.status] ?? STATUS_COLORS.draft}`}
                        >
                          {def.status}
                        </span>
                      </div>
                      <p className="font-mono text-xs text-hq-fg-muted">{def.slug}</p>
                      <p className="mt-1 text-xs text-hq-fg-muted">
                        {t("pointsSummary", {
                          count: Object.keys(def.pointsByDay).length,
                        })}
                        {def.iconPhash ? ` · ${t("hasIconHash")}` : ` · ${t("missingIcon")}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <label className="cursor-pointer rounded-lg border border-hq-border px-3 py-2 text-xs text-hq-fg">
                      {iconUploading ? t("uploadingIcon") : t("uploadIcon")}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="sr-only"
                        disabled={iconUploading}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void handleIconUpload(def.id, file);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className="rounded-lg border border-hq-border px-3 py-2 text-xs text-hq-fg"
                      onClick={() => {
                        setEditingId(def.id);
                        setShowForm(false);
                        setForm(formFromDef(def));
                      }}
                    >
                      {t("edit")}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ItemDefFields({
  form,
  setForm,
  t,
}: {
  form: typeof EMPTY_FORM;
  setForm: React.Dispatch<React.SetStateAction<typeof EMPTY_FORM>>;
  t: ReturnType<typeof useTranslations<"admin.vsInventoryItemsPage">>;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm">
        <span className="text-hq-fg-muted">{t("slugLabel")}</span>
        <input
          className="mt-1 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 font-mono text-sm text-hq-fg"
          value={form.slug}
          onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
          required
        />
      </label>
      <label className="block text-sm">
        <span className="text-hq-fg-muted">{t("nameLabel")}</span>
        <input
          className="mt-1 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
          value={form.displayName}
          onChange={(e) =>
            setForm((f) => ({ ...f, displayName: e.target.value }))
          }
          required
        />
      </label>
      <label className="block text-sm">
        <span className="text-hq-fg-muted">{t("statusLabel")}</span>
        <select
          className="mt-1 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
          value={form.status}
          onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
        >
          <option value="draft">{t("statusDraft")}</option>
          <option value="active">{t("statusActive")}</option>
          <option value="retired">{t("statusRetired")}</option>
        </select>
      </label>
      <label className="block text-sm">
        <span className="text-hq-fg-muted">{t("sortOrderLabel")}</span>
        <input
          type="number"
          className="mt-1 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
          value={form.sortOrder}
          onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
        />
      </label>
      {([1, 2, 3, 4, 5] as const).map((day) => (
        <label key={day} className="block text-sm">
          <span className="text-hq-fg-muted">{t("dayPointsLabel", { day })}</span>
          <input
            type="number"
            min={0}
            className="mt-1 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
            value={form[`day${day}`]}
            onChange={(e) =>
              setForm((f) => ({ ...f, [`day${day}`]: e.target.value }))
            }
          />
        </label>
      ))}
    </div>
  );
}
