"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  VsScoreDayTemplate,
  VsScoreTemplate,
  VsScoreWeekTemplate,
} from "@/lib/video/vs-fixture-types";

type ScrapeMode = "day" | "week";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function templateRowCount(t: VsScoreTemplate): number {
  if (t.kind === "week") {
    return t.days.reduce((sum, d) => sum + d.rows.length, 0);
  }
  return t.rows.length;
}

function TemplateCard({
  template,
  onDelete,
  onEdit,
  onSnapshot,
  snapshotting,
}: {
  template: VsScoreTemplate;
  onDelete: (id: string) => void;
  onEdit: (id: string, name: string, tags: string[]) => void;
  onSnapshot: (id: string) => void;
  snapshotting: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(template.name);
  const [editTags, setEditTags] = useState(template.tags.join(", "));

  const dateLabel =
    template.kind === "week"
      ? `Week of ${template.sourceWeekStart}`
      : template.sourceRecordedDate;

  const dayCount =
    template.kind === "week" ? `${template.days.length} days` : null;

  return (
    <div className="rounded-lg border border-hq-border bg-hq-surface p-3 text-sm">
      {editing ? (
        <div className="space-y-2">
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="w-full rounded border border-hq-border bg-hq-surface-muted px-2 py-1 text-sm text-hq-fg"
            placeholder="Name"
          />
          <input
            value={editTags}
            onChange={(e) => setEditTags(e.target.value)}
            className="w-full rounded border border-hq-border bg-hq-surface-muted px-2 py-1 text-xs text-hq-fg"
            placeholder="Tags (comma separated)"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                onEdit(
                  template.id,
                  editName.trim(),
                  editTags
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                );
                setEditing(false);
              }}
              className="rounded bg-hq-success px-2 py-1 text-xs text-white"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-xs text-hq-fg-muted underline"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-medium text-hq-fg">{template.name}</p>
              <p className="mt-0.5 text-xs text-hq-fg-muted">
                {template.kind} · {dateLabel} · {templateRowCount(template)}{" "}
                rows
                {dayCount ? ` · ${dayCount}` : ""}
              </p>
              {template.tags.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {template.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-hq-surface-muted px-1.5 py-0.5 text-[10px] text-hq-fg-muted"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-xs text-hq-fg-muted underline"
                title="Edit name/tags"
              >
                Edit
              </button>
              <a
                href={`/api/dev/vs-score-fixtures/${template.id}/export`}
                download={`${template.id}.json`}
                className="text-xs text-hq-fg-muted underline"
                title="Download JSON for git commit"
              >
                Export
              </a>
              <button
                type="button"
                onClick={() => onDelete(template.id)}
                className="text-xs text-hq-danger underline"
                title="Delete"
              >
                Delete
              </button>
            </div>
          </div>
          <button
            type="button"
            disabled={snapshotting === template.id}
            onClick={() => onSnapshot(template.id)}
            className="mt-2 inline-block text-xs text-hq-success underline disabled:opacity-50"
          >
            {snapshotting === template.id
              ? "Creating snapshot…"
              : "Create snapshot →"}
          </button>
        </>
      )}
    </div>
  );
}

export function VsScoreLibraryClient() {
  const [templates, setTemplates] = useState<VsScoreTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  // Scraper state
  const [scrapeMode, setScrapeMode] = useState<ScrapeMode>("day");
  const [scrapeDate, setScrapeDate] = useState(todayIso());
  const [scraping, setScraping] = useState(false);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [scrapePreview, setScrapePreview] = useState<VsScoreTemplate | null>(
    null,
  );
  const [saveName, setSaveName] = useState("");
  const [saveTags, setSaveTags] = useState("");
  const [saving, setSaving] = useState(false);

  // Library filters
  const [tagFilter, setTagFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<"" | "day" | "week">("");
  const [search, setSearch] = useState("");

  const loadLibrary = useCallback(async () => {
    try {
      const res = await fetch("/api/dev/vs-score-fixtures");
      const data = (await res.json()) as VsScoreTemplate[];
      if (Array.isArray(data)) setTemplates(data);
    } catch {
      // noop
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => {
      void loadLibrary();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const t of templates) {
      for (const tag of t.tags) tags.add(tag);
    }
    return Array.from(tags).sort();
  }, [templates]);

  const filtered = useMemo(() => {
    let result = templates;
    if (tagFilter) result = result.filter((t) => t.tags.includes(tagFilter));
    if (kindFilter) result = result.filter((t) => t.kind === kindFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [templates, tagFilter, kindFilter, search]);

  async function handleScrape() {
    setScraping(true);
    setScrapeError(null);
    setScrapePreview(null);
    try {
      const param =
        scrapeMode === "day"
          ? `date=${scrapeDate}`
          : `weekStart=${scrapeDate}`;
      const res = await fetch(`/api/dev/vs-score-fixtures/scrape?${param}`);
      const data = await res.json();
      if (!res.ok) {
        setScrapeError(data.error ?? "Scrape failed");
        return;
      }
      setScrapePreview(data as VsScoreTemplate);
      setSaveName(data.name ?? "");
    } catch (err) {
      setScrapeError(err instanceof Error ? err.message : "Scrape failed");
    } finally {
      setScraping(false);
    }
  }

  async function handleSave() {
    if (!scrapePreview || !saveName.trim()) return;
    setSaving(true);
    try {
      const tags = saveTags
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const payload: Record<string, unknown> =
        scrapePreview.kind === "week"
          ? {
              sourceWeekStart: (scrapePreview as VsScoreWeekTemplate)
                .sourceWeekStart,
              days: (scrapePreview as VsScoreWeekTemplate).days,
            }
          : {
              sourceRecordedDate: (scrapePreview as VsScoreDayTemplate)
                .sourceRecordedDate,
              rows: (scrapePreview as VsScoreDayTemplate).rows,
            };

      await fetch("/api/dev/vs-score-fixtures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: saveName.trim(),
          tags,
          kind: scrapePreview.kind,
          payload,
        }),
      });

      setScrapePreview(null);
      setSaveName("");
      setSaveTags("");
      await loadLibrary();
    } finally {
      setSaving(false);
    }
  }

  const [snapshotting, setSnapshotting] = useState<string | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  async function handleSnapshot(fixtureId: string) {
    setSnapshotting(fixtureId);
    setSnapshotError(null);
    try {
      const res = await fetch("/api/dev/vs-score-fixtures/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fixtureId, scoreTarget: "vs-performance" }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        jobId?: string;
        error?: string;
      };
      if (!res.ok || !data.jobId) {
        setSnapshotError(data.error ?? "Snapshot creation failed");
        return;
      }
      window.location.href = `/tools/video-upload/${data.jobId}/review`;
    } catch (err) {
      setSnapshotError(
        err instanceof Error ? err.message : "Snapshot creation failed",
      );
    } finally {
      setSnapshotting(null);
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/dev/vs-score-fixtures/${id}`, { method: "DELETE" });
    await loadLibrary();
  }

  async function handleEdit(id: string, name: string, tags: string[]) {
    await fetch(`/api/dev/vs-score-fixtures/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, tags }),
    });
    await loadLibrary();
  }

  return (
    <div className="space-y-8">
      {/* --- Scrape panel --- */}
      <section className="rounded-xl border border-hq-border bg-hq-surface p-4 sm:p-5">
        <h2 className="text-lg font-semibold">Scrape VS Scores</h2>
        <p className="mt-1 text-xs text-hq-fg-muted">
          Read-only fetch from Ashed using your alliance connection. No writes.
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="scrapeMode"
              value="day"
              checked={scrapeMode === "day"}
              onChange={() => setScrapeMode("day")}
            />
            Single day
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="scrapeMode"
              value="week"
              checked={scrapeMode === "week"}
              onChange={() => setScrapeMode("week")}
            />
            Week (Mon–Sat)
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs text-hq-fg-muted">
              {scrapeMode === "day" ? "Date" : "Week start (Monday)"}
            </span>
            <input
              type="date"
              value={scrapeDate}
              onChange={(e) => setScrapeDate(e.target.value)}
              className="rounded-lg border border-hq-border bg-hq-surface-muted px-3 py-1.5 text-sm text-hq-fg"
            />
          </label>
          <button
            type="button"
            onClick={() => void handleScrape()}
            disabled={scraping || !scrapeDate}
            className="rounded-lg bg-hq-success px-4 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {scraping ? "Scraping…" : "Scrape"}
          </button>
        </div>

        {scrapeError ? (
          <p className="mt-3 text-sm text-hq-danger">{scrapeError}</p>
        ) : null}

        {scrapePreview ? (
          <div className="mt-4 space-y-3">
            <h3 className="text-sm font-medium">
              Preview: {templateRowCount(scrapePreview)} rows (
              {scrapePreview.kind})
            </h3>

            <div className="max-h-48 overflow-auto rounded border border-hq-border">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-hq-surface-muted">
                  <tr>
                    <th className="px-2 py-1">Rank</th>
                    <th className="px-2 py-1">Name</th>
                    <th className="px-2 py-1 text-right">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {(scrapePreview.kind === "day"
                    ? scrapePreview.rows
                    : scrapePreview.days[0]?.rows ?? []
                  ).map((row, i) => (
                    <tr
                      key={i}
                      className="border-t border-hq-border/50"
                    >
                      <td className="px-2 py-0.5 tabular-nums">
                        {row.rank ?? i + 1}
                      </td>
                      <td className="px-2 py-0.5">{row.name}</td>
                      <td className="px-2 py-0.5 text-right tabular-nums">
                        {row.score.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {scrapePreview.kind === "week" ? (
              <p className="text-xs text-hq-fg-muted">
                {(scrapePreview as VsScoreWeekTemplate).days.length} days
                scraped. Preview shows day 1 above.
              </p>
            ) : null}

            <div className="flex flex-wrap items-end gap-3">
              <label className="block flex-1">
                <span className="mb-1 block text-xs text-hq-fg-muted">
                  Template name
                </span>
                <input
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  className="w-full rounded-lg border border-hq-border bg-hq-surface-muted px-3 py-1.5 text-sm text-hq-fg"
                  placeholder="e.g. LFgo busy Tuesday"
                />
              </label>
              <label className="block flex-1">
                <span className="mb-1 block text-xs text-hq-fg-muted">
                  Tags (comma separated)
                </span>
                <input
                  value={saveTags}
                  onChange={(e) => setSaveTags(e.target.value)}
                  className="w-full rounded-lg border border-hq-border bg-hq-surface-muted px-3 py-1.5 text-sm text-hq-fg"
                  placeholder="e.g. lfgo, high-volume"
                />
              </label>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || !saveName.trim()}
                className="rounded-lg bg-hq-success px-4 py-1.5 text-sm text-white disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save to library"}
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                const blob = new Blob(
                  [JSON.stringify(scrapePreview, null, 2)],
                  { type: "application/json" },
                );
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${scrapePreview.id}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="text-xs text-hq-fg-muted underline"
            >
              Download JSON for git commit
            </button>
          </div>
        ) : null}
      </section>

      {/* --- Library browser --- */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Library</h2>

        <div className="flex flex-wrap gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, id, or tag…"
            className="min-w-0 flex-1 rounded-lg border border-hq-border bg-hq-surface px-3 py-1.5 text-sm text-hq-fg"
          />
          <select
            value={kindFilter}
            onChange={(e) =>
              setKindFilter(e.target.value as "" | "day" | "week")
            }
            className="rounded-lg border border-hq-border bg-hq-surface px-2 py-1.5 text-xs text-hq-fg"
          >
            <option value="">All kinds</option>
            <option value="day">Day</option>
            <option value="week">Week</option>
          </select>
          {allTags.length > 0 ? (
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="rounded-lg border border-hq-border bg-hq-surface px-2 py-1.5 text-xs text-hq-fg"
            >
              <option value="">All tags</option>
              {allTags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        {loading ? (
          <p className="text-sm text-hq-fg-muted">Loading library…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-hq-fg-muted">
            {templates.length === 0
              ? "No fixtures yet. Scrape one above to get started."
              : "No fixtures match your filters."}
          </p>
        ) : (
          <>
            {snapshotError ? (
              <p className="text-sm text-hq-danger">{snapshotError}</p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              {filtered.map((t) => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  onDelete={handleDelete}
                  onEdit={handleEdit}
                  onSnapshot={handleSnapshot}
                  snapshotting={snapshotting}
                />
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
