"use client";

import { useEffect, useId, useRef, useState, type HTMLAttributes, type ReactNode, type DragEvent } from "react";
import { AppSelect } from "@/components/ui/AppSelect";
import { filterAppSelectOptions } from "@/components/ui/app-select-search";
import { dropBoardMember, encodeMemberDrag, focusBoardMember, memberDragType, memberLocation, swipeDirection, type BoardMember, type BoardGroup, type MemberBoardData, type MemberBoardInteractions } from "@/lib/member-board/board.shared";

export const boardButton = "rounded-lg border border-hq-border px-3 py-2 text-sm hover:bg-hq-surface-muted disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-hq-accent";
const boardInput = "w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm";
type DataAttributes = { [key: `data-${string}`]: string | boolean };
export type MemberBoardLabels = {
  pool: string; search: string; findMember: string; noMatches: string; memberUnavailable: string;
  addMember: string; moveMember: string; removeMember: string; emptyPool: string; emptyGroup: string;
  groupName: string; preferredGroup: string; noGroup: string; openPool: string; closePool: string;
  back: string; next: string; swipeHint: string; close?: string;
};
export type MemberBoardRenderers<M extends BoardMember, G extends BoardGroup> = {
  member: (member: M) => ReactNode;
  memberIdentity?: (member: M) => ReactNode;
  memberActions?: (member: M, group: G | null) => ReactNode;
  groupHeader?: (group: G, preferred: boolean) => ReactNode;
  groupActions?: (group: G) => ReactNode;
  groupMessage?: (group: G, canAdd: boolean) => ReactNode;
  groupCommands?: (group: G) => ReactNode;
  groupSummary?: (group: G) => ReactNode;
  error?: (code: string | undefined, reveal: boolean) => ReactNode;
  filters?: ReactNode;
  matchesFilter?: (member: M) => boolean;
  setup?: ReactNode;
  mobileStatus?: ReactNode;
  attributes?: { member?: (member: M) => DataAttributes; group?: (group: G) => DataAttributes; pool?: DataAttributes };
};
export type MemberBoardProps<M extends BoardMember = BoardMember, G extends BoardGroup = BoardGroup> = {
  data: MemberBoardData<M, G>; locale: string; labels: MemberBoardLabels; interactions: MemberBoardInteractions;
  renderers: MemberBoardRenderers<M, G>;
  activity?: { pending?: boolean; pendingGroupIds?: readonly string[]; errors?: Record<string, string>; poolError?: string };
  children?: ReactNode;
};

export function MemberBoardSearch<M extends BoardMember, G extends BoardGroup>({ data, labels, label, value, onSelect, eligible, renderIdentity }: {
  data: MemberBoardData<M, G>; labels: Pick<MemberBoardLabels, "pool" | "findMember" | "noMatches">; label: string; value: string;
  onSelect: (id: string) => void; eligible?: (id: string) => boolean; renderIdentity?: (member: M) => ReactNode;
}) {
  return <AppSelect value={value} onChange={onSelect} combobox searchable explicitSelection retainFocusOnSelect searchMode="fuzzy" aria-label={label} placeholder={label} searchPlaceholder={labels.findMember} noSearchResultsLabel={labels.noMatches} options={data.members.map((member) => ({ value: member.id, selectedText: member.name, label: <span>{renderIdentity?.(member) ?? member.name}<span className="ml-2 text-xs text-hq-fg-muted">{data.groups.find((group) => group.memberIds.includes(member.id))?.name ?? labels.pool}</span></span>, searchText: [member.name, ...(member.searchTerms ?? [])].join(" "), disabled: eligible ? !eligible(member.id) : false }))} />;
}

function PoolDrawer({ title, closeLabel, children, onClose }: { title: string; closeLabel: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} onCancel={(event) => { event.preventDefault(); onClose(); }} aria-label={title} className="fixed inset-0 m-auto max-h-[90dvh] w-[min(96vw,56rem)] overflow-y-auto rounded-xl border border-hq-border bg-hq-surface p-4 text-hq-fg backdrop:bg-black/70">
    <div className="mb-4 flex items-center justify-between gap-4"><h2 className="text-lg font-semibold">{title}</h2><button type="button" className={boardButton} onClick={onClose}>{closeLabel}</button></div>{children}
  </dialog>;
}

function GroupSelection({ children, search }: { children: ReactNode; search: (value: string, select: (id: string) => void) => ReactNode }) {
  const [selected, setSelected] = useState("");
  return <>{search(selected, setSelected)}{children}</>;
}

export function MemberBoard<M extends BoardMember, G extends BoardGroup>(props: MemberBoardProps<M, G>) {
  return <MemberBoardWorkspace key={props.data.scope} {...props} />;
}

function MemberBoardWorkspace<M extends BoardMember, G extends BoardGroup>({ data, locale, labels, interactions, renderers, activity = {}, children }: MemberBoardProps<M, G>) {
  const instance = useId();
  const scope = { workspace: data.scope, instance };
  const root = useRef<HTMLDivElement>(null);
  const [visibleId, setVisibleId] = useState(() => data.preferredGroupId ?? data.groups[0]?.id ?? "");
  const [poolOpen, setPoolOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [located, setLocated] = useState("");
  const [dragged, setDragged] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const touch = useRef<{ x: number; y: number; interactive: boolean } | null>(null);
  const dragFrame = useRef<number | null>(null);
  const endDrag = () => {
    if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current);
    dragFrame.current = null;
    setDragged(null);
  };
  useEffect(() => () => { if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current); }, []);
  const visible = data.groups.find((group) => group.id === visibleId) ?? data.groups[0];
  const preferred = data.groups.find((group) => group.id === data.preferredGroupId);
  const groupName = (id: string | null) => data.groups.find((group) => group.id === id)?.name ?? labels.pool;
  const pending = (id: string | null) => !!activity.pending || (id !== null && !!activity.pendingGroupIds?.includes(id));
  const eligible = (id: string, to: string | null) => !pending(to) && !interactions.eligibility(id, to);
  const move = (id: string, to: string | null) => { if (data.members.some((member) => member.id === id) && eligible(id, to)) interactions.onMove(id, to); };
  const navigate = (delta: number) => { const next = data.groups[data.groups.findIndex((group) => group.id === visible?.id) + delta]; if (next) setVisibleId(next.id); };
  const locate = (id: string) => {
    setLocated(id);
    const location = memberLocation(data.groups, id);
    if (location) { setVisibleId(location); setPoolOpen(false); } else { setPoolOpen(true); }
    setFocusRequest((value) => value + 1);
  };
  useEffect(() => {
    if (!focusRequest || !located) return;
    const timer = requestAnimationFrame(() => { if (root.current) focusBoardMember(root.current, located); });
    return () => cancelAnimationFrame(timer);
  }, [focusRequest, located]);
  const dropBindings = (to: string | null): HTMLAttributes<HTMLElement> => ({
    onDragOver: (event) => { if (dragged && eligible(dragged, to)) event.preventDefault(); },
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      dropBoardMember(event.dataTransfer.getData(memberDragType), scope, data, interactions, to, pending(to));
      endDrag();
    },
  });
  const groupOptions = (memberId?: string) => data.groups.map((group) => ({ value: group.id, label: group.optionLabel ?? group.name, disabled: memberId ? !eligible(memberId, group.id) : false }));
  const renderMember = (member: M, group: G | null, mobile = false, locatedOnly = false) => {
    const movable = [null, ...data.groups.map((item) => item.id)].some((to) => !interactions.eligibility(member.id, to));
    const draggable = !locatedOnly && !pending(group?.id ?? null) && movable;
    return <article key={member.id} {...renderers.attributes?.member?.(member)} data-member-board-member={member.id} tabIndex={-1} draggable={draggable}
      onDragStart={(event) => {
        event.dataTransfer.setData(memberDragType, encodeMemberDrag(scope, member.id));
        event.dataTransfer.effectAllowed = "move";
        if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current);
        dragFrame.current = requestAnimationFrame(() => { dragFrame.current = null; setDragged(member.id); });
      }} onDragEnd={endDrag}
      className={`rounded-lg border border-hq-border bg-hq-canvas p-3 text-sm focus-visible:ring-2 focus-visible:ring-hq-accent ${located === member.id ? "ring-2 ring-hq-accent" : ""} ${draggable ? "cursor-grab" : ""}`}>
      {renderers.member(member)}
      {!locatedOnly && <>{group ? movable && <div className="mt-2 flex flex-wrap gap-2"><AppSelect value="" onChange={(to) => move(member.id, JSON.parse(to) as string | null)} aria-label={`${labels.moveMember}: ${member.name}`} placeholder={labels.moveMember} disabled={pending(group.id)} options={[{ value: "null", label: labels.removeMember, disabled: !eligible(member.id, null) }, ...groupOptions(member.id).map((option) => ({ ...option, value: JSON.stringify(option.value) }))]} /></div>
        : mobile && visible ? <button type="button" className={`${boardButton} mt-2`} disabled={!eligible(member.id, visible.id)} onClick={() => move(member.id, visible.id)}>{labels.addMember}: {visible.name}</button>
          : <AppSelect value="" onChange={(to) => move(member.id, to)} aria-label={`${labels.addMember}: ${member.name}`} placeholder={labels.addMember} noSearchResultsLabel={labels.noMatches} disabled={!!activity.pending || !data.groups.length} options={groupOptions(member.id)} />}
        {renderers.memberActions?.(member, group)}</>}
    </article>;
  };
  const pool = data.members.filter((member) => !memberLocation(data.groups, member.id));
  const filtered = pool.filter((member) => renderers.matchesFilter?.(member) ?? true);
  const results = filterAppSelectOptions(filtered.map((member) => ({ value: member.id, label: member.name, searchText: [member.name, ...(member.searchTerms ?? [])].join(" ") })), query, "fuzzy", false);
  const renderPool = (mobile: boolean) => <section {...renderers.attributes?.pool} aria-label={labels.pool} data-member-board-pool className="space-y-2" {...dropBindings(null)}>
    <h2 className="font-semibold">{labels.pool} <span className="text-sm text-hq-fg-muted">{results.length.toLocaleString(locale)} / {pool.length.toLocaleString(locale)}</span></h2>
    {mobile && <div className="sticky top-0 z-10 space-y-2 bg-hq-surface py-2">{data.preferredGroupId !== undefined && <p className="text-sm">{labels.preferredGroup}: {preferred?.name ?? labels.noGroup}</p>}{renderers.mobileStatus}{visible && <><p className="text-sm">{labels.addMember}: {visible.name}</p>{renderers.groupActions?.(visible)}</>}</div>}
    <label className="block text-sm">{labels.search}<input type="search" className={boardInput} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    {renderers.filters}
    {renderers.error?.(activity.poolError || (mobile && visible ? activity.errors?.[visible.id] : undefined), true)}
    {dragged && renderers.error?.(interactions.eligibility(dragged, null) ?? undefined, false)}
    {mobile && pool.some((member) => member.id === located) && !results.some((option) => option.value === located) && renderMember(pool.find((member) => member.id === located)!, null, true, true)}
    <div className="max-h-[65dvh] space-y-2 overflow-y-auto overscroll-contain">{results.map((option) => renderMember(pool.find((member) => member.id === option.value)!, null, mobile))}</div>
    {!pool.length && <p>{labels.emptyPool}</p>}{!!pool.length && !results.length && <p>{labels.noMatches}</p>}
  </section>;
  return <div ref={root} data-member-board-scope={instance} className="space-y-4">
    <div className="sticky top-0 z-20 space-y-2 rounded-xl border border-hq-border bg-hq-surface p-3 lg:static">
      {data.preferredGroupId !== undefined && <div className="flex items-center justify-between gap-2 lg:hidden"><div><strong>{labels.preferredGroup}</strong><p className="text-sm">{preferred ? renderers.groupSummary?.(preferred) ?? preferred.name : labels.noGroup}</p></div>{preferred && <button className={boardButton} onClick={() => setVisibleId(preferred.id)}>{labels.preferredGroup}</button>}</div>}
      {children}<button className={`${boardButton} lg:hidden`} onClick={() => setPoolOpen(true)}>{labels.openPool}</button>
    </div>
    <div className="max-w-xl space-y-2"><MemberBoardSearch data={data} labels={labels} label={labels.findMember} value={located} onSelect={locate} renderIdentity={renderers.memberIdentity} />
      {located && <div role="status">{data.members.some((member) => member.id === located) ? <button className={boardButton} onClick={() => locate(located)}>{data.members.find((member) => member.id === located)?.name} · {groupName(memberLocation(data.groups, located))}</button> : labels.memberUnavailable}</div>}
    </div>
    <div className="space-y-3 lg:hidden"><AppSelect value={visible?.id ?? ""} onChange={setVisibleId} combobox searchable explicitSelection searchMode="fuzzy" aria-label={labels.groupName} placeholder={labels.groupName} searchPlaceholder={labels.groupName} noSearchResultsLabel={labels.noMatches} options={groupOptions()} />
      <div className="flex justify-between"><button className={boardButton} disabled={!visible || data.groups[0]?.id === visible.id} onClick={() => navigate(-1)}>{labels.back}</button><button className={boardButton} disabled={!visible || data.groups.at(-1)?.id === visible.id} onClick={() => navigate(1)}>{labels.next}</button></div><p className="text-xs text-hq-fg-muted">{labels.swipeHint}</p>
    </div>
    {renderers.setup}
    <div className="grid gap-4 lg:grid-cols-[minmax(15rem,19rem)_1fr]">
      <aside className="hidden self-start rounded-xl border border-hq-border bg-hq-surface p-4 lg:block">{renderPool(false)}</aside>
      <div className="grid min-w-0 gap-4 lg:grid-cols-[repeat(auto-fit,minmax(17rem,1fr))]" style={{ touchAction: "pan-y" }}
        onTouchStart={(event) => { const point = event.touches[0]; touch.current = { x: point.clientX, y: point.clientY, interactive: !!(event.target as HTMLElement).closest("input,button,select,textarea,[role=combobox],[role=listbox],a,dialog") }; }}
        onTouchEnd={(event) => { if (!touch.current) return; const point = event.changedTouches[0]; const direction = swipeDirection(point.clientX - touch.current.x, point.clientY - touch.current.y, touch.current.interactive, !!window.getSelection()?.toString()); touch.current = null; if (direction) navigate(direction); }}>
        {data.groups.map((group) => {
          const canAdd = data.members.some((member) => !interactions.eligibility(member.id, group.id));
          const dropError = dragged ? interactions.eligibility(dragged, group.id) : null;
          return <div key={group.id} className={group.id === visible?.id ? "min-w-0" : "hidden min-w-0 lg:block"}>
            <section {...renderers.attributes?.group?.(group)} data-member-board-group={group.id} aria-label={group.name} aria-busy={pending(group.id)} className={`min-w-0 space-y-3 rounded-xl border bg-hq-surface p-4 ${group.id === preferred?.id ? "border-hq-accent" : "border-hq-border"} ${dragged && dropError ? "opacity-70" : ""}`} {...dropBindings(group.id)}>
              {renderers.groupHeader?.(group, group.id === preferred?.id) ?? <header><h2 className="font-semibold">{group.name}</h2></header>}
              {renderers.groupActions?.(group)}
              <GroupSelection search={(value, select) => <MemberBoardSearch data={data} labels={labels} label={labels.addMember} value={value} onSelect={(id) => { select(id); move(id, group.id); }} eligible={(id) => eligible(id, group.id)} renderIdentity={renderers.memberIdentity} />}>
                {renderers.groupMessage?.(group, canAdd)}
                {renderers.error?.(activity.errors?.[group.id], true)}
                {dragged && renderers.error?.(dropError ?? undefined, false)}
              </GroupSelection>
              {renderers.groupCommands?.(group)}
              <div className="max-h-[65dvh] space-y-2 overflow-y-auto overscroll-contain">{group.memberIds.map((id) => { const member = data.members.find((row) => row.id === id); return member ? renderMember(member, group) : null; })}{!group.memberIds.length && <p>{labels.emptyGroup}</p>}</div>
            </section>
          </div>;
        })}
      </div>
    </div>
    {poolOpen && <PoolDrawer title={labels.pool} closeLabel={labels.close ?? labels.closePool} onClose={() => setPoolOpen(false)}>{renderPool(true)}<button className={`${boardButton} mt-4`} onClick={() => setPoolOpen(false)}>{labels.closePool}</button></PoolDrawer>}
  </div>;
}
