"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { APP_SELECT_FUZZY_MIN_SCORE, appSelectOptionFuzzyScore } from "@/components/ui/app-select-search";
import type { PerformanceNoteRosterMember } from "@/lib/performance-notes/types.shared";

type Props = {
  roster: PerformanceNoteRosterMember[];
  attachedIds: string[];
  disabled?: boolean;
  onSave: (memberIds: string[]) => Promise<void>;
};

export function NoteMemberMultiSelect({
  roster,
  attachedIds,
  disabled,
  onSave,
}: Props) {
  const t = useTranslations("notes");
  const attached = useMemo(() => new Set(attachedIds), [attachedIds]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);

  const available = useMemo(() => {
    return roster.filter((row) => !attached.has(row.ashedMemberId));
  }, [roster, attached]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return available.slice(0, 40);
    return available
      .map((row) => ({
        row,
        score: appSelectOptionFuzzyScore(
          {
            value: row.ashedMemberId,
            label: row.name,
            searchText: row.name,
          },
          q,
        ),
      }))
      .filter((entry) => entry.score >= APP_SELECT_FUZZY_MIN_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, 40)
      .map((entry) => entry.row);
  }, [available, query]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    if (selected.size === 0 || saving) return;
    setSaving(true);
    try {
      await onSave([...selected]);
      setSelected(new Set());
      setQuery("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 space-y-2">
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("searchMembers")}
        disabled={disabled || saving}
        className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
      />
      <div className="max-h-48 overflow-y-auto rounded-lg border border-hq-border bg-hq-surface">
        {filtered.length === 0 ? (
          <p className="px-3 py-2 text-sm text-hq-fg-muted">{t("noMemberMatches")}</p>
        ) : (
          <ul className="divide-y divide-hq-border">
            {filtered.map((row) => {
              const checked = selected.has(row.ashedMemberId);
              return (
                <li key={row.ashedMemberId}>
                  <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-hq-fg hover:bg-hq-canvas">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled || saving}
                      onChange={() => toggle(row.ashedMemberId)}
                    />
                    <span>{row.name}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <button
        type="button"
        onClick={() => void save()}
        disabled={disabled || saving || selected.size === 0}
        className="rounded-lg bg-hq-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {saving ? t("saving") : t("saveMembers")}
      </button>
    </div>
  );
}
