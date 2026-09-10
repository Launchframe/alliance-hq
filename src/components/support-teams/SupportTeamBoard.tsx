"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AppSelect } from "@/components/ui/AppSelect";
import { filterAppSelectOptions } from "@/components/ui/app-select-search";
import type { SupportSnapshot } from "@/lib/support-teams/types.shared";
import { matchesUnsortedFilters, type SupportDisplayPreferences, type UnsortedFilters } from "@/lib/support-teams/display-preferences.shared";
import { locationOf, ownTeamId, swipeDirection } from "@/lib/support-teams/board-client.shared";
import { SupportMemberChip } from "./SupportMemberChip";
import { SupportTeamMemberSearch, SupportTeamSlot, type BoardInteractions } from "./SupportTeamSlot";
import { SupportDialog, SupportErrorMessage, UnsortedFiltersControl, supportButton, supportInput } from "./SupportTeamControls";

export function SupportTeamBoard({ snapshot, display, interactions, pending, errors, renderMemberActions, renderSlotControls, pendingTeamIds = [], mobileStatus, children }: {
  snapshot: SupportSnapshot; display: SupportDisplayPreferences; interactions: BoardInteractions; pending: string | null; errors: Record<string, string>;
  renderMemberActions?: (id: string) => ReactNode; renderSlotControls?: (teamId: string) => ReactNode; pendingTeamIds?: string[]; mobileStatus?: ReactNode; children?: ReactNode;
}) {
  const t = useTranslations("supportTeams");
  const tr = useTranslations();
  const locale = useLocale();
  const own = ownTeamId(snapshot);
  const [visibleId, setVisibleId] = useState(() => own ?? snapshot.teams[0]?.id ?? "");
  const [poolOpen, setPoolOpen] = useState(false);
  const [filters, setFilters] = useState<UnsortedFilters>({});
  const [query, setQuery] = useState("");
  const [located, setLocated] = useState("");
  const [dragged, setDragged] = useState<string | null>(null);
  const [addLead, setAddLead] = useState(false);
  const [setupTeamId, setSetupTeamId] = useState("");
  const [focusRequest, setFocusRequest] = useState(0);
  const touch = useRef<{ x: number; y: number; interactive: boolean } | null>(null);
  const visible = snapshot.teams.find((team) => team.id === visibleId) ?? snapshot.teams[0];
  const ownTeam = snapshot.teams.find((team) => team.id === own);
  const teamName = (id: string | null) => id === null ? t("unsorted") : snapshot.teams.find((team) => team.id === id)?.name ?? t("defaultName", { number: (Math.max(0, snapshot.teams.findIndex((team) => team.id === id)) + 1).toLocaleString(locale) });
  const navigate = (delta: number) => {
    const index = snapshot.teams.findIndex((team) => team.id === visible?.id);
    const next = snapshot.teams[index + delta];
    if (next) setVisibleId(next.id);
  };
  const locate = (id: string) => {
    setLocated(id);
    const location = locationOf(snapshot, id);
    if (location) { setVisibleId(location); setPoolOpen(false); } else { setPoolOpen(true); }
    setFocusRequest((value) => value + 1);
  };
  useEffect(() => {
    if (!focusRequest || !located) return;
    const timer = requestAnimationFrame(() => {
      const elements = document.querySelectorAll<HTMLElement>("[data-support-member]");
      const target = [...elements].find((element) => element.dataset.supportMember === located && element.getClientRects().length > 0);
      target?.scrollIntoView({ block: "nearest", behavior: "instant" });
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(timer);
  }, [focusRequest, located]);
  const pool = snapshot.roster.filter((member) => !locationOf(snapshot, member.id));
  const filtered = pool.filter((member) => matchesUnsortedFilters(member, filters));
  const results = filterAppSelectOptions(filtered.map((member) => ({ value: member.id, label: member.name, searchText: [member.name, ...member.previousNames].join(" ") })), query, "fuzzy", false);
  const renderPool = (mobile: boolean) => <section aria-label={t("unsorted")} data-support-pool className="space-y-2"
    onDragOver={(event) => { if (dragged && !interactions.eligibility(dragged, null)) event.preventDefault(); }}
    onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData("application/x-support-member"); if (id && !pending && !interactions.eligibility(id, null)) interactions.onMove(id, null); setDragged(null); }}>
    <h2 className="font-semibold">{t("unsorted")} <span className="text-sm text-hq-fg-muted">{results.length.toLocaleString(locale)} / {pool.length.toLocaleString(locale)}</span></h2>
    {mobile && <div className="sticky top-0 z-10 space-y-2 bg-hq-surface py-2"><p className="text-sm">{t("myTeam")}: {ownTeam ? teamName(ownTeam.id) : t("noTeam")}</p>{mobileStatus}{visible && <><p className="text-sm">{t("addMember")}: {teamName(visible.id)}</p>{renderSlotControls?.(visible.id)}</>}</div>}
    <label className="block text-sm">{tr("members.search")}<input type="search" className={supportInput} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    <UnsortedFiltersControl filters={filters} setFilters={setFilters} roster={snapshot.roster} />
    <SupportErrorMessage code={errors.unsorted || (mobile && visible ? errors[visible.id] : undefined)} />
    {dragged && <SupportErrorMessage code={interactions.eligibility(dragged, null) ?? undefined} reveal={false} />}
    {mobile && pool.some((member) => member.id === located) && !results.some((option) => option.value === located) && <SupportMemberChip member={pool.find((member) => member.id === located)!} display={display} highlighted />}
    <div className="max-h-[65dvh] space-y-2 overflow-y-auto overscroll-contain">{results.map((option) => { const member = pool.find((row) => row.id === option.value)!; return <SupportMemberChip key={member.id} member={member} display={display} highlighted={located === member.id} draggable={!pending && snapshot.teams.some((team) => !interactions.eligibility(member.id, team.id))} onDrag={setDragged} onDragEnd={() => setDragged(null)}>
      {mobile && visible ? <button type="button" className={`${supportButton} mt-2`} disabled={!!pending || !!interactions.eligibility(member.id, visible.id)} onClick={() => interactions.onMove(member.id, visible.id)}>{t("addMember")}: {teamName(visible.id)}</button> : <AppSelect value="" onChange={(to) => interactions.onMove(member.id, to)} aria-label={`${t("addMember")}: ${member.name}`} placeholder={t("addMember")} noSearchResultsLabel={t("noMatches")} disabled={!!pending || !snapshot.teams.length} options={snapshot.teams.map((team) => ({ value: team.id, label: `${teamName(team.id)} · ${snapshot.roster.find((row) => row.id === team.leadId)?.name ?? t("unknown")}`, disabled: !!interactions.eligibility(member.id, team.id) }))} />}
      {renderMemberActions?.(member.id)}
    </SupportMemberChip>; })}</div>
    {!pool.length && <p>{t("emptyPool")}</p>}{!!pool.length && !results.length && <p>{t("noMatches")}</p>}
  </section>;
  return <div className="space-y-4">
    <div className="sticky top-0 z-20 space-y-2 rounded-xl border border-hq-border bg-hq-surface p-3 lg:static">
      <div className="flex items-center justify-between gap-2 lg:hidden"><div><strong>{t("myTeam")}</strong><p className="text-sm">{ownTeam ? `${teamName(ownTeam.id)} · ${t("size", { count: ownTeam.memberIds.length.toLocaleString(locale), target: ownTeam.target.toLocaleString(locale) })}` : t("noTeam")}</p></div>{own && <button className={supportButton} onClick={() => setVisibleId(own)}>{t("myTeam")}</button>}</div>
      {children}
      <button className={`${supportButton} lg:hidden`} onClick={() => setPoolOpen(true)}>{t("openPool")}</button>
    </div>
    <div className="max-w-xl space-y-2"><SupportTeamMemberSearch snapshot={snapshot} teamName={teamName} label={t("findMember")} value={located} onSelect={locate} />
      {located && <div role="status">{snapshot.roster.some((member) => member.id === located) ? <button className={supportButton} onClick={() => locate(located)}>{snapshot.roster.find((member) => member.id === located)?.name} · {teamName(locationOf(snapshot, located))}</button> : t("memberUnavailable")}</div>}
    </div>
    <div className="space-y-3 lg:hidden"><AppSelect value={visible?.id ?? ""} onChange={setVisibleId} combobox searchable explicitSelection searchMode="fuzzy" aria-label={t("teamName")} placeholder={t("teamName")} searchPlaceholder={t("teamName")} noSearchResultsLabel={t("noMatches")} options={snapshot.teams.map((team) => ({ value: team.id, label: `${teamName(team.id)} · ${snapshot.roster.find((member) => member.id === team.leadId)?.name ?? t("unknown")}` }))} />
      <div className="flex justify-between"><button className={supportButton} disabled={!visible || snapshot.teams[0]?.id === visible.id} onClick={() => navigate(-1)}>{tr("common.back")}</button><button className={supportButton} disabled={!visible || snapshot.teams.at(-1)?.id === visible.id} onClick={() => navigate(1)}>{tr("common.next")}</button></div><p className="text-xs text-hq-fg-muted">{t("swipeHint")}</p>
    </div>
    {snapshot.actor?.override && !snapshot.published && !snapshot.board?.construction && <div><button className={supportButton} onClick={() => { if (!setupTeamId || snapshot.teams.some((team) => team.id === setupTeamId)) setSetupTeamId(crypto.randomUUID()); setAddLead(!addLead); }}>{t("addLead")}</button>{addLead && <AppSelect value="" onChange={(leadId) => interactions.onCommand({ kind: "createTeam", teamId: setupTeamId, leadId, expectedVersion: snapshot.version }, "setup")} aria-label={t("addLead")} placeholder={t("leadRequired")} combobox searchable explicitSelection searchMode="fuzzy" searchPlaceholder={t("findMember")} noSearchResultsLabel={t("noMatches")} options={snapshot.roster.filter((member) => member.rank === 4 || member.rank === 5).map((member) => ({ value: member.id, label: member.name, disabled: !!pending || !interactions.canCommand({ kind: "createTeam", teamId: setupTeamId, leadId: member.id, expectedVersion: snapshot.version }) }))} />}<SupportErrorMessage code={errors.setup} /></div>}
    <div className="grid gap-4 lg:grid-cols-[minmax(15rem,19rem)_1fr]">
      <aside className="hidden self-start rounded-xl border border-hq-border bg-hq-surface p-4 lg:block">{renderPool(false)}</aside>
      <div className="grid min-w-0 gap-4 lg:grid-cols-[repeat(auto-fit,minmax(17rem,1fr))]" style={{ touchAction: "pan-y" }}
        onTouchStart={(event) => { const point = event.touches[0]; touch.current = { x: point.clientX, y: point.clientY, interactive: !!(event.target as HTMLElement).closest("input,button,select,textarea,[role=combobox],[role=listbox],a,dialog") }; }}
        onTouchEnd={(event) => { if (!touch.current) return; const point = event.changedTouches[0]; const direction = swipeDirection(point.clientX - touch.current.x, point.clientY - touch.current.y, touch.current.interactive, !!window.getSelection()?.toString()); touch.current = null; if (direction) navigate(direction); }}>
        {snapshot.teams.map((team) => <div key={team.id} className={team.id === visible?.id ? "min-w-0" : "hidden min-w-0 lg:block"}><SupportTeamSlot snapshot={snapshot} team={team} teamName={teamName} own={team.id === own} display={display} highlighted={located} dragged={dragged} setDragged={setDragged} interactions={interactions} pending={!!pending || pendingTeamIds.includes(team.id)} error={errors[team.id]} renderMemberActions={renderMemberActions}>{renderSlotControls?.(team.id)}</SupportTeamSlot></div>)}
      </div>
    </div>
    {poolOpen && <SupportDialog title={t("unsorted")} onClose={() => setPoolOpen(false)}>{renderPool(true)}<button className={`${supportButton} mt-4`} onClick={() => setPoolOpen(false)}>{t("closePool")}</button></SupportDialog>}
  </div>;
}
