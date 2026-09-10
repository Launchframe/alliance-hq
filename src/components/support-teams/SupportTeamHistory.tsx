"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AppSelect } from "@/components/ui/AppSelect";
import type { SupportEvent, SupportSnapshot, UndoPreview } from "@/lib/support-teams/types.shared";
import { SupportClientError, supportRequest } from "@/lib/support-teams/board-client.shared";
import { historyKindLabels, historyNames, humanizePatch, undoConfirmation, type HistoryResult, type HistoryRow } from "@/lib/support-teams/history-client.shared";
import { SupportDialog, SupportErrorMessage, supportButton, supportInput } from "./SupportTeamControls";

export function SupportTeamHistory({ snapshot, onChanged }: { snapshot: SupportSnapshot; onChanged: () => Promise<void> }) {
  const t = useTranslations("supportTeams");
  const tr = useTranslations();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<HistoryResult>({ events: [], nextBeforeVersion: null });
  const [known, setKnown] = useState<Record<string, HistoryRow>>({});
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState<number | undefined>();
  const [back, setBack] = useState<(number | undefined)[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [root, setRoot] = useState<HistoryRow | null>(null);
  const [preview, setPreview] = useState<UndoPreview | null>(null);
  const [affected, setAffected] = useState<HistoryRow[]>([]);
  const [previewError, setPreviewError] = useState("");
  const [busy, setBusy] = useState(false);
  const attempt = useRef("");
  const lock = useRef(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    try {
      const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
      if (cursor !== undefined) params.set("beforeVersion", String(cursor));
      const next = await supportRequest<HistoryResult>(`/api/support-teams/history?${params}`);
      if (request !== generation.current) return;
      setPage(next);
      setKnown((old) => ({ ...old, ...Object.fromEntries(next.events.map((event) => [event.id, event])) }));
      setError("");
    } catch (failure) { if (request === generation.current) setError(failure instanceof SupportClientError ? failure.code : "changed"); }
    finally { if (request === generation.current) setLoading(false); }
  }, [cursor, filters]);
  const invalidateLoad = useCallback(() => { generation.current++; }, []);
  useEffect(() => { if (open) { const timer = setTimeout(() => void load(), 150); return () => { clearTimeout(timer); invalidateLoad(); }; } }, [invalidateLoad, load, open, snapshot.version]);
  const names = (event: SupportEvent) => historyNames(snapshot, event, (number) => t("defaultName", { number: number.toLocaleString(locale) }), t("unknown"), t("unsorted"));
  const summary = (event: SupportEvent) => {
    const n = names(event);
    const actor = event.actorType === "service" ? t("title") : event.actorName ?? t("unknown");
    if (event.kind === "rename") {
      const patch = event.patches.find((row) => JSON.parse(row.key)[2] === "name");
      return t("history.renamed", { actor, team: n.team(event.teamIds[0]), name: typeof patch?.after === "string" ? patch.after : t("unknown") });
    }
    if (event.kind === "createTeam" || event.kind === "replaceLead") {
      const patch = event.patches.find((row) => JSON.parse(row.key)[2] === "lead");
      return t("history.leadChanged", { actor, lead: n.member(String(patch?.after ?? "")), team: n.team(event.teamIds[0]) });
    }
    if (event.kind === "reconcile" && event.patches.length === 0) return t("saved");
    if (event.kind === "undo") return t("history.reversed", { actor, action: event.reverses.map((id) => known[id]?.boardVersion.toLocaleString(locale) ?? t("unknown")).join(", ") });
    return event.patches.filter((patch) => JSON.parse(patch.key)[0] === "member").map((patch) => t("history.moved", { actor, member: n.member(JSON.parse(patch.key)[1]), from: n.team(patch.before === null ? null : String(patch.before)), to: n.team(patch.after === null ? null : String(patch.after)) })).join(" ");
  };
  const details = (event: SupportEvent, patches = event.patches) => <dl className="mt-2 space-y-1 text-xs text-hq-fg-muted">{patches.map((patch, index) => {
    const value = humanizePatch(patch, names(event), { teamName: t("teamName"), lead: t("replaceLead"), member: t("findMember"), unknown: t("unknown"), yes: tr("admin.yes"), no: tr("admin.no") }, locale);
    return <div key={`${patch.key}-${index}`}><dt>{value.label}</dt><dd>{value.before} → {value.after}</dd></div>;
  })}</dl>;
  const openPreview = async (event: HistoryRow) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setRoot(event);
    setPreview(null);
    setAffected([]);
    setPreviewError("");
    try {
      const next = await supportRequest<UndoPreview>(`/api/support-teams/history/${encodeURIComponent(event.id)}/undo-preview`, { method: "POST" });
      let before: number | null = null;
      const rows: HistoryRow[] = [];
      do {
        const result: HistoryResult = await supportRequest(`/api/support-teams/history?limit=50${before ? `&beforeVersion=${before}` : ""}`);
        rows.push(...result.events.filter((row) => next.actionIds.includes(row.id)));
        before = result.nextBeforeVersion;
      } while (before && rows.length < next.actionIds.length);
      if (rows.length !== next.actionIds.length) throw new SupportClientError("changed", 409);
      setKnown((old) => ({ ...old, ...Object.fromEntries(rows.map((row) => [row.id, row])) }));
      setAffected(next.actionIds.map((id) => rows.find((row) => row.id === id)!));
      setPreview(next);
      attempt.current = crypto.randomUUID();
    } catch (failure) { setPreviewError(failure instanceof SupportClientError ? failure.code : "changed"); }
    finally { lock.current = false; setBusy(false); }
  };
  const confirm = async () => {
    if (!preview || !root || lock.current) return;
    lock.current = true;
    setBusy(true);
    setPreviewError("");
    try {
      await supportRequest(`/api/support-teams/history/${encodeURIComponent(root.id)}/undo`, { method: "POST", body: JSON.stringify(undoConfirmation(preview, attempt.current)) });
      setRoot(null);
      setPreview(null);
      await onChanged();
      await load();
    } catch (failure) {
      setPreviewError(failure instanceof SupportClientError ? failure.code : "changed");
      if (failure instanceof SupportClientError) setPreview(null);
      await onChanged();
    } finally { lock.current = false; setBusy(false); }
  };
  const changeFilter = (key: string, value: string) => { setFilters((old) => ({ ...old, [key]: value })); setCursor(undefined); setBack([]); };
  const rows = Object.values(known);
  const optionFilter = (key: string, label: string, options: { value: string; label: string }[]) => <AppSelect value={filters[key] ?? ""} onChange={(value) => changeFilter(key, value)} aria-label={label} placeholder={label} searchable combobox explicitSelection searchMode="fuzzy" searchPlaceholder={label} noSearchResultsLabel={t("history.empty")} options={[{ value: "", label: t("resetFilters") }, ...options]} />;
  return <><button className={supportButton} onClick={() => setOpen(true)}>{t("history.title")}</button>
    {open && <SupportDialog title={t("history.title")} onClose={() => setOpen(false)}><p className="mb-4 text-sm text-hq-fg-muted">{t("history.ownHint")}</p>
      <div className="grid gap-2 sm:grid-cols-2"><label className="text-sm">{tr("members.search")}<input className={supportInput} type="search" value={filters.query ?? ""} onChange={(event) => changeFilter("query", event.target.value)} /></label>
        {optionFilter("actorId", tr("admin.auditPage.table.hqUser"), [...new Map(rows.map((row) => [row.principalId, { value: row.principalId, label: row.actorName ?? t("unknown") }])).values()])}
        {optionFilter("teamId", t("teamName"), snapshot.teams.map((team, index) => ({ value: team.id, label: team.name ?? t("defaultName", { number: (index + 1).toLocaleString(locale) }) })))}
        {optionFilter("memberId", t("findMember"), snapshot.roster.map((member) => ({ value: member.id, label: member.name })))}
        {optionFilter("kind", tr("admin.auditPage.filters.action"), Object.entries(historyKindLabels).map(([value, key]) => ({ value, label: t(key) })))}
        {optionFilter("contextId", t("history.title"), [...new Map(rows.flatMap((row) => { const id = row.context.draftId ?? row.context.proposalId; return id ? [[id, { value: id, label: `${t(historyKindLabels[row.kind])} · ${new Date(row.at).toLocaleString(locale)}` }] as const] : []; })).values()])}
      </div><button className={`${supportButton} my-3`} onClick={() => { setFilters({}); setCursor(undefined); setBack([]); }}>{t("resetFilters")}</button>
      <SupportErrorMessage code={error} history />{loading && <p role="status">{tr("common.loading")}</p>}
      <ol className="space-y-3" aria-busy={loading}>{page.events.map((event) => <li key={event.id} className="rounded-lg border border-hq-border p-3"><p>{summary(event)}</p><time dateTime={event.at} className="text-xs text-hq-fg-muted">{new Date(event.at).toLocaleString(locale)}</time>{details(event)}
        {event.reversalId && <p className="text-sm">{t("history.undone")}</p>}
        {event.undoBlocked && <SupportErrorMessage code={event.undoBlocked} history reveal={false} />}
        {snapshot.actor?.canWrite && (snapshot.actor.override || event.principalId === snapshot.actor.principalId) && !event.reversalId && <button className={`${supportButton} mt-2`} disabled={busy} onClick={() => void openPreview(event)}>{t("history.preview")}</button>}
      </li>)}</ol>{!page.events.length && !loading && <p>{t("history.empty")}</p>}
      <div className="mt-4 flex justify-between"><button className={supportButton} disabled={!back.length || loading} onClick={() => { setCursor(back.at(-1)); setBack((old) => old.slice(0, -1)); }}>{tr("common.back")}</button><button className={supportButton} disabled={!page.nextBeforeVersion || loading} onClick={() => { setBack((old) => [...old, cursor]); setCursor(page.nextBeforeVersion ?? undefined); }}>{tr("common.next")}</button></div>
    </SupportDialog>}
    {root && <SupportDialog title={t("history.preview")} onClose={() => { if (!busy) setRoot(null); }}>
      <p>{summary(root)}</p><SupportErrorMessage code={previewError} history />
      {busy && <p role="status">{tr("common.loading")}</p>}
      {preview && <><h3 className="mt-3 font-semibold">{t("history.cascade")}</h3><p className="text-sm">{t("history.cascadeHint")}</p><ol className="my-3 space-y-3">{affected.map((event) => <li key={event.id} className="rounded-lg border border-hq-border p-3"><p>{summary(event)}</p><time dateTime={event.at}>{new Date(event.at).toLocaleString(locale)}</time>{details(event)}</li>)}</ol>{details(root, preview.patches)}<button className={supportButton} disabled={busy} onClick={() => void confirm()}>{t("history.confirm", { count: preview.actionIds.length.toLocaleString(locale) })}</button></>}
      <button className={`${supportButton} ml-2`} disabled={busy} onClick={() => void openPreview(root)}>{t("history.preview")}</button>
    </SupportDialog>}
  </>;
}
