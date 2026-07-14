"use client";

import { useEffect, useMemo, useState } from "react";

import { Link } from "@/i18n/navigation";
import type {
  VsScoreTemplate,
  VsScoreWeekTemplate,
} from "@/lib/video/vs-fixture-types";

type Props = {
  value: string | null;
  dayIndex: number | null;
  onChange: (fixtureId: string | null, dayIndex: number | null) => void;
};

function templateRowCount(t: VsScoreTemplate): number {
  if (t.kind === "week") {
    return t.days.reduce((sum, d) => sum + d.rows.length, 0);
  }
  return t.rows.length;
}

function templateDateLabel(t: VsScoreTemplate): string {
  if (t.kind === "week") return `Week of ${t.sourceWeekStart}`;
  return t.sourceRecordedDate;
}

export function VsFixturePicker({ value, dayIndex, onChange }: Props) {
  const [templates, setTemplates] = useState<VsScoreTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [tagFilter, setTagFilter] = useState("");

  useEffect(() => {
    void fetch("/api/dev/vs-score-fixtures")
      .then((r) => r.json())
      .then((data: VsScoreTemplate[]) => {
        if (Array.isArray(data)) setTemplates(data);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const t of templates) {
      for (const tag of t.tags) tags.add(tag);
    }
    return Array.from(tags).sort();
  }, [templates]);

  const filtered = useMemo(() => {
    if (!tagFilter) return templates;
    return templates.filter((t) => t.tags.includes(tagFilter));
  }, [templates, tagFilter]);

  const selected = useMemo(
    () => templates.find((t) => t.id === value) ?? null,
    [templates, value],
  );

  if (loading) {
    return (
      <p className="text-xs text-hq-fg-muted">Loading fixture library…</p>
    );
  }

  if (templates.length === 0) {
    return (
      <p className="text-xs text-hq-fg-muted">
        No fixtures available. Scrape some from{" "}
        <Link href="/dev/vs-score-library" className="underline">
          VS Score Library
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={value ?? ""}
          onChange={(e) => {
            const id = e.target.value || null;
            onChange(id, null);
          }}
          className="min-w-0 flex-1 rounded-lg border border-hq-border bg-hq-surface px-3 py-1.5 text-sm text-hq-fg"
          aria-label="VS score fixture"
        >
          <option value="">None (use real OCR)</option>
          {filtered.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.kind}, {templateRowCount(t)} rows,{" "}
              {templateDateLabel(t)})
            </option>
          ))}
        </select>

        {allTags.length > 0 ? (
          <select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            className="rounded-lg border border-hq-border bg-hq-surface px-2 py-1.5 text-xs text-hq-fg"
            aria-label="Filter by tag"
          >
            <option value="">All tags</option>
            {allTags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        ) : null}

        {value ? (
          <button
            type="button"
            onClick={() => onChange(null, null)}
            className="text-xs text-hq-fg-muted underline"
          >
            Clear
          </button>
        ) : null}
      </div>

      {selected?.kind === "week" ? (
        <label className="flex items-center gap-2 text-xs text-hq-fg-muted">
          <span>Day index:</span>
          <select
            value={dayIndex ?? 0}
            onChange={(e) => onChange(value, Number(e.target.value))}
            className="rounded border border-hq-border bg-hq-surface px-2 py-1 text-xs text-hq-fg"
          >
            {(selected as VsScoreWeekTemplate).days.map((day, i) => (
              <option key={i} value={i}>
                Day {i + 1} — {day.sourceRecordedDate} ({day.rows.length} rows)
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {selected ? (
        <p className="text-xs text-hq-fg-muted">
          Fixture mode: OCR will use {selected.name} data instead of real video
          frames. Submit will write to the local HQ ledger (never Ashed).
        </p>
      ) : null}
    </div>
  );
}
