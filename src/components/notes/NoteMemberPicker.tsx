"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Search, X } from "lucide-react";
import type { PerformanceNoteRosterMember } from "@/lib/performance-notes/types.shared";

export function NoteMemberPicker({ roster, selectedIds, detectedIds, disabled, onAdd, onRemove }: {
  roster: PerformanceNoteRosterMember[];
  selectedIds: string[];
  detectedIds: string[];
  disabled?: boolean;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const t = useTranslations("notes");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = new Set(selectedIds);
  const candidates = useMemo(() => roster.filter((member) => !selectedIds.includes(member.ashedMemberId) && [member.name, ...(member.previousNames ?? [])].some((name) => name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))).slice(0, 30), [query, roster, selectedIds]);
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      {roster.filter((member) => selected.has(member.ashedMemberId)).map((member) => <span key={member.ashedMemberId} className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-hq-border bg-hq-surface px-2 py-1 text-xs">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-hq-accent/10 font-semibold text-hq-accent" aria-hidden="true">{member.name.slice(0, 1).toLocaleUpperCase()}</span>
        <span className="truncate">{member.name}</span>
        {detectedIds.includes(member.ashedMemberId) ? <span className="h-1.5 w-1.5 rounded-full bg-hq-accent" title={t("editor.detected")} /> : null}
        {!disabled ? <button type="button" onClick={() => onRemove(member.ashedMemberId)} className="rounded p-0.5 text-hq-fg-muted hover:bg-hq-surface-muted hover:text-hq-fg" aria-label={t("editor.removeMember", { name: member.name })}><X className="h-3.5 w-3.5" /></button> : null}
      </span>)}
      {!disabled ? <button type="button" onClick={() => setOpen(!open)} className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-hq-border px-2 py-1.5 text-xs text-hq-fg-muted hover:border-hq-accent hover:text-hq-accent" aria-expanded={open}><Plus className="h-3.5 w-3.5" />{t("editor.addMember")}</button> : null}
      {disabled && selected.size === 0 ? <span className="text-xs text-hq-fg-muted">{t("editor.noMembers")}</span> : null}
    </div>
    {open && !disabled ? <div className="overflow-hidden rounded-lg border border-hq-border bg-hq-canvas shadow-sm">
      <div className="flex items-center gap-2 border-b border-hq-border px-3"><Search className="h-4 w-4 shrink-0 text-hq-fg-muted" /><input autoFocus type="search" aria-label={t("searchMembers")} placeholder={t("searchMembers")} value={query} onChange={(event) => setQuery(event.target.value)} className="w-full bg-transparent py-2 text-sm outline-none" /></div>
      <div className="max-h-44 overflow-y-auto p-1">
        {candidates.length ? candidates.map((member) => <button key={member.ashedMemberId} type="button" onClick={() => { onAdd(member.ashedMemberId); setQuery(""); }} className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-hq-surface"><span>{member.name}</span><Plus className="h-3.5 w-3.5 text-hq-fg-muted" /></button>) : <p className="px-3 py-3 text-xs text-hq-fg-muted">{t("noMemberMatches")}</p>}
      </div>
    </div> : null}
  </div>;
}
