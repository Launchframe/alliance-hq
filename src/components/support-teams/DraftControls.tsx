"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { DraftSnapshot } from "@/lib/support-teams/draft.shared";
import type { SupportSnapshot } from "@/lib/support-teams/types.shared";
import { canPickDraftMember, currentDraftPhase, workingDraftSnapshot } from "@/lib/support-teams/board-client.shared";
import { SupportDialog } from "./SupportTeamControls";

export type DraftBoardAdapter = {
  snapshot: DraftSnapshot;
  workingDraftSnapshot: SupportSnapshot;
  status: ReactNode;
  pick: (teamId: string, memberId: string) => Promise<boolean>;
  canPickMember: (teamId: string, memberId: string) => boolean;
  pendingTeamIds: string[];
  errors: Record<string, string>;
  renderSlotControls: (teamId: string) => ReactNode;
};
export type DraftControlsProps = {
  snapshot: DraftSnapshot | null;
  publishedVersion: number;
  canManage: boolean;
  canSchedule: boolean;
  onRefresh: (minimumVersion?: number) => void | Promise<void>;
  onCreated: (id: string) => void | Promise<void>;
  renderBoard?: (adapter: DraftBoardAdapter) => ReactNode;
};
function DraftBoardContent({ renderBoard, adapter }: { renderBoard: NonNullable<DraftControlsProps["renderBoard"]>; adapter: DraftBoardAdapter }) {
  return renderBoard(adapter);
}
const inputClass = "rounded-lg border border-hq-border bg-hq-surface px-3 py-2 text-hq-fg";
const buttonClass = "rounded-lg border border-hq-border px-3 py-2 text-sm disabled:opacity-50";
export function DraftControls({ snapshot, publishedVersion, canManage, canSchedule, onRefresh, onCreated, renderBoard }: DraftControlsProps) {
  const t = useTranslations("supportTeams.draft");
  const root = useTranslations();
  const locale = useLocale();
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [roundMinutes, setRoundMinutes] = useState(5);
  const [extension, setExtension] = useState("");
  const [confirmPartial, setConfirmPartial] = useState<boolean | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [extendOpen, setExtendOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState({ serverNow: "", milliseconds: 0 });
  const busy = useRef(new Set<string>());
  const attempts = useRef(new Map<string, string>());
  const anchors = useRef(new Map<string, HTMLDivElement>());
  useEffect(() => {
    const began = performance.now();
    const timer = window.setInterval(() => setElapsed({ serverNow: snapshot?.serverNow ?? "", milliseconds: performance.now() - began }), 1000);
    return () => window.clearInterval(timer);
  }, [snapshot?.serverNow]);
  const now = snapshot ? Date.parse(snapshot.serverNow) + (elapsed.serverNow === snapshot.serverNow ? elapsed.milliseconds : 0) : 0;
  const phase = snapshot ? currentDraftPhase(snapshot, now) : undefined;
  const time = (value: string) => new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(value));
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  function errorNode(key: string) {
    return <div ref={(node) => { if (node) anchors.current.set(key, node); else anchors.current.delete(key); }} aria-live="polite">{errors[key] ? <p role="alert" className="text-sm text-hq-danger">{errors[key]}</p> : null}</div>;
  }
  async function send(key: string, path: string, input: Record<string, unknown>): Promise<boolean> {
    if (busy.current.has(key)) return false;
    busy.current.add(key);
    setPending([...busy.current]);
    setErrors((current) => ({ ...current, [key]: "" }));
    const fingerprint = JSON.stringify([path, input]);
    const idempotencyKey = attempts.current.get(fingerprint) ?? crypto.randomUUID();
    attempts.current.set(fingerprint, idempotencyKey);
    let succeeded = false;
    try {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, idempotencyKey }) });
      const body = await response.json().catch(() => null) as { error?: string; draftId?: string; version?: number } | null;
      if (!response.ok) {
        if (response.status < 500) attempts.current.delete(fingerprint);
        setErrors((current) => ({ ...current, [key]: body?.error || root("supportTeams.changed") }));
        if (response.status === 409) await onRefresh();
        return false;
      }
      attempts.current.delete(fingerprint);
      succeeded = true;
      if (body?.draftId) await onCreated(body.draftId);
      await onRefresh(body?.version);
      return true;
    } catch {
      setErrors((current) => ({ ...current, [key]: root("discordBot.errors.serverError") }));
      return succeeded;
    } finally {
      busy.current.delete(key);
      setPending([...busy.current]);
      if (!succeeded) requestAnimationFrame(() => anchors.current.get(key)?.scrollIntoView({ block: "nearest" }));
    }
  }
  const active = snapshot && phase !== "published" && phase !== "canceled";
  const manager = snapshot ? snapshot.actor.canManage : canManage;
  const path = snapshot ? `/api/support-teams/drafts/${encodeURIComponent(snapshot.id)}` : "/api/support-teams/drafts";
  function canPickMember(teamId: string, memberId: string) {
    return snapshot ? canPickDraftMember(snapshot, teamId, memberId, now, pending) : false;
  }
  async function pick(teamId: string, memberId: string) {
    if (!snapshot) return false;
    const team = snapshot.teams.find((item) => item.id === teamId);
    if (!team || !canPickMember(teamId, memberId)) {
      setErrors((current) => ({ ...current, [teamId]: t("notOpen") }));
      requestAnimationFrame(() => anchors.current.get(teamId)?.scrollIntoView({ block: "nearest" }));
      return false;
    }
    return send(teamId, `${path}/pick`, { teamId, memberId, expectedRound: snapshot.currentRound, expectedRoundVersion: snapshot.resourceVersions.round, expectedSlotVersion: team.slotVersion, expectedMemberVersion: snapshot.resourceVersions.members[memberId] });
  }
  function renderSlotControls(teamId: string) {
    const team = snapshot?.teams.find((item) => item.id === teamId);
    if (!team || !snapshot) return null;
    const lead = snapshot.roster.find((item) => item.id === team.leadId)?.name ?? team.name ?? t("title");
    return <div className="space-y-1 text-sm" aria-busy={pending.includes(teamId)}>
      <p>{team.proxy ? t("pickFor", { lead }) : t("pick")}</p>
      {team.picked ? <p>{t("picked")}</p> : phase !== "open" ? <p>{t("notOpen")}</p> : team.proxy && !manager && now < Date.parse(snapshot.deadline) ? <p>{t("proxyEarly", { time: time(snapshot.deadline) })}</p> : null}
      {errorNode(teamId)}
    </div>;
  }
  const waiting = snapshot?.teams.filter((team) => team.applicable && !team.picked).map((team) => snapshot.roster.find((m) => m.id === team.leadId)?.name ?? team.name ?? t("title")) ?? [];
  const seconds = snapshot ? Math.max(0, Math.ceil((Date.parse(snapshot.deadline) - now) / 1000)) : 0;
  const structuralBusy = pending.length > 0;
  const status = snapshot && active ? <div className="space-y-1" role="status">
    <p>{t("startsAt")}: {time(snapshot.config.startsAt)} · {t("endsAt")}: {time(snapshot.config.endsAt)}</p>
    <p>{t("round", { round: number(snapshot.currentRound) })} · {t("deadline", { time: time(snapshot.deadline) })} <time aria-label={t("deadline", { time: time(snapshot.deadline) })}>{number(Math.floor(seconds / 60))}:{new Intl.NumberFormat(locale, { minimumIntegerDigits: 2 }).format(seconds % 60)}</time></p>
    {phase === "scheduled" ? <p>{t("preparation")}</p> : phase === "expired" ? <p>{t("expired")}</p> : waiting.length ? <p>{t("waiting", { names: new Intl.ListFormat(locale).format(waiting) })}</p> : null}
    {!snapshot.rosterValid ? <p className="text-hq-danger">{root("supportTeams.memberUnavailable")}</p> : null}
    <p className="text-sm text-hq-fg-muted">{t("proxyHint")}</p>
  </div> : null;
  return <section aria-label={t("title")} className="space-y-4">
    <h2 className="text-lg font-semibold">{t("title")}</h2>
    {!active && canSchedule ? <><button type="button" className={buttonClass} onClick={() => setScheduleOpen(true)}>{t("create")}</button>{scheduleOpen && <SupportDialog title={t("create")} onClose={() => { if (!structuralBusy) setScheduleOpen(false); }}><form className="flex flex-wrap items-end gap-3" onSubmit={async (event) => { event.preventDefault(); if (await send("schedule", "/api/support-teams/drafts", { startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), roundMinutes, expectedVersion: snapshot?.version ?? publishedVersion })) setScheduleOpen(false); }}>
      <p>{t("preparation")}</p>
      <label className="grid gap-1">{t("startsAt")}<input required type="datetime-local" className={inputClass} value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label>
      <label className="grid gap-1">{t("endsAt")}<input required type="datetime-local" className={inputClass} value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label>
      <label className="grid gap-1">{t("roundDuration")}<input required type="number" min={1} max={1440} className={inputClass} value={roundMinutes} onChange={(event) => setRoundMinutes(Number(event.target.value))} /></label>
      <button className={buttonClass} disabled={structuralBusy}>{t("create")}</button>
      {errorNode("schedule")}
    </form></SupportDialog>}</> : null}
    {snapshot && active ? <>
      {renderBoard ? <DraftBoardContent renderBoard={renderBoard} adapter={{ snapshot, workingDraftSnapshot: workingDraftSnapshot(snapshot), status, pick, canPickMember, pendingTeamIds: pending.filter((key) => snapshot.teams.some((team) => team.id === key)), errors, renderSlotControls }} /> : status}
      {manager ? <div className="space-y-3">
        <button type="button" className={buttonClass} onClick={() => setExtendOpen(true)}>{t("extend")}</button>
        {extendOpen && <SupportDialog title={t("extend")} onClose={() => { if (!structuralBusy) setExtendOpen(false); }}><form className="flex flex-wrap items-end gap-3" onSubmit={async (event) => { event.preventDefault(); if (await send("extend", `${path}/extend`, { endsAt: new Date(extension).toISOString(), expectedVersion: snapshot.version })) setExtendOpen(false); }}>
          <label className="grid gap-1">{t("endsAt")}<input required type="datetime-local" className={inputClass} value={extension} onChange={(event) => setExtension(event.target.value)} /></label>
          <button className={buttonClass} disabled={structuralBusy}>{t("extend")}</button>
          {errorNode("extend")}
        </form></SupportDialog>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} disabled={structuralBusy || phase === "scheduled" || !snapshot.rosterValid || Object.values(snapshot.memberLocations).some((team) => team === null)} onClick={() => setConfirmPartial(false)}>{t("publish")}</button>
          <button type="button" className={buttonClass} disabled={structuralBusy || phase === "scheduled" || !snapshot.rosterValid} onClick={() => setConfirmPartial(true)}>{t("finishPartial")}</button>
          <button type="button" className={buttonClass} disabled={structuralBusy} onClick={() => setCancelOpen(true)}>{root("timeOff.officerModal.cancel")}</button>
        </div>
        {cancelOpen && <SupportDialog title={root("timeOff.officerModal.cancel")} onClose={() => { if (!structuralBusy) setCancelOpen(false); }}><p>{t("title")}</p><button type="button" className={buttonClass} disabled={structuralBusy} onClick={async () => { if (await send("cancel", `${path}/cancel`, { expectedVersion: snapshot.version })) setCancelOpen(false); }}>{root("timeOff.officerModal.cancel")}</button>{errorNode("cancel")}</SupportDialog>}
        {confirmPartial !== null ? <SupportDialog title={t("publish")} onClose={() => { if (!structuralBusy) setConfirmPartial(null); }}><div className="space-y-2" role="group" aria-label={t("publishConfirm")}>
          <p>{t("publishConfirm")}</p>
          <button type="button" className={buttonClass} disabled={structuralBusy} onClick={async () => { if (await send("publish", `${path}/publish`, { expectedVersion: snapshot.version, allowUnsorted: confirmPartial })) setConfirmPartial(null); }}>{t("publish")}</button>
          <button type="button" className={buttonClass} onClick={() => setConfirmPartial(null)}>{root("timeOff.officerModal.cancel")}</button>
          {errorNode("publish")}
        </div></SupportDialog> : null}
      </div> : null}
    </> : null}
  </section>;
}
