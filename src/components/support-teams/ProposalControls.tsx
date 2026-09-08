"use client";

import { useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ProposalSnapshot } from "@/lib/support-teams/proposal.shared";

export type ProposalBoardAdapter = {
  snapshot: ProposalSnapshot;
  move: (memberId: string, to: string | null) => Promise<boolean>;
  swap: (memberId: string, otherMemberId: string) => Promise<boolean>;
  canMoveMember: (memberId: string, to: string | null) => boolean;
  canSwapMembers: (memberId: string, otherMemberId: string) => boolean;
  pendingTeamIds: string[];
  errors: Record<string, string>;
  renderSlotControls: (teamId: string) => ReactNode;
};
export type ProposalControlsProps = {
  snapshot: ProposalSnapshot | null;
  publishedVersion: number;
  canCreate: boolean;
  onRefresh: () => void | Promise<void>;
  onCreated: (id: string) => void | Promise<void>;
  renderBoard?: (adapter: ProposalBoardAdapter) => ReactNode;
};
function ProposalBoardContent({ renderBoard, adapter }: { renderBoard: NonNullable<ProposalControlsProps["renderBoard"]>; adapter: ProposalBoardAdapter }) {
  return renderBoard(adapter);
}
const buttonClass = "rounded-lg border border-hq-border px-3 py-2 text-sm disabled:opacity-50";
export function ProposalControls({ snapshot, publishedVersion, canCreate, onRefresh, onCreated, renderBoard }: ProposalControlsProps) {
  const t = useTranslations("supportTeams.proposals");
  const root = useTranslations();
  const locale = useLocale();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string[]>([]);
  const [overrideConfirmation, setOverrideConfirmation] = useState<string | null>(null);
  const busy = useRef(false);
  const attempts = useRef(new Map<string, string>());
  const anchors = useRef(new Map<string, HTMLDivElement>());
  const path = snapshot ? `/api/support-teams/proposals/${encodeURIComponent(snapshot.id)}` : "/api/support-teams/proposals";
  const confirmationBasis = JSON.stringify([snapshot?.id, snapshot?.proposalVersion, snapshot?.publishedVersion, snapshot?.version]);
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  function errorNode(key: string) {
    return <div ref={(node) => { if (node) anchors.current.set(key, node); else anchors.current.delete(key); }} aria-live="polite">{errors[key] ? <p role="alert" className="text-sm text-hq-danger">{errors[key]}</p> : null}</div>;
  }
  async function send(key: string, endpoint: string, input: Record<string, unknown>, teams: string[] = []): Promise<boolean> {
    if (busy.current) return false;
    busy.current = true; setPending([key, ...teams]); setErrors((current) => ({ ...current, [key]: "" }));
    const fingerprint = JSON.stringify([endpoint, input]);
    const idempotencyKey = attempts.current.get(fingerprint) ?? crypto.randomUUID();
    attempts.current.set(fingerprint, idempotencyKey);
    let succeeded = false;
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, idempotencyKey }) });
      const body = await response.json().catch(() => null) as { error?: string; proposalId?: string } | null;
      if (!response.ok) {
        if (response.status < 500) attempts.current.delete(fingerprint);
        setErrors((current) => ({ ...current, [key]: body?.error || root("supportTeams.changed") }));
        if (response.status === 409) await onRefresh();
        return false;
      }
      succeeded = true; attempts.current.delete(fingerprint);
      if (body?.proposalId) await onCreated(body.proposalId);
      await onRefresh(); return true;
    } catch {
      setErrors((current) => ({ ...current, [key]: root("discordBot.errors.serverError") })); return succeeded;
    } finally {
      busy.current = false; setPending([]);
      requestAnimationFrame(() => anchors.current.get(key)?.scrollIntoView({ block: "nearest" }));
    }
  }
  function movable(memberId: string) {
    return Boolean(snapshot?.canEdit && !pending.length && snapshot.roster.some((m) => m.id === memberId) && !snapshot.teams.some((team) => team.leadId === memberId));
  }
  function canMoveMember(memberId: string, to: string | null) {
    const target = snapshot?.teams.find((team) => team.id === to);
    return Boolean(movable(memberId) && snapshot?.memberLocations[memberId] !== to && (to === null || (target && target.memberIds.length < target.target)));
  }
  function canSwapMembers(memberId: string, otherMemberId: string) {
    return Boolean(movable(memberId) && movable(otherMemberId) && memberId !== otherMemberId && snapshot?.memberLocations[memberId] && snapshot.memberLocations[otherMemberId] && snapshot.memberLocations[memberId] !== snapshot.memberLocations[otherMemberId]);
  }
  function blocked(key: string) {
    setErrors((current) => ({ ...current, [key]: root("supportTeams.changed") }));
    requestAnimationFrame(() => anchors.current.get(key)?.scrollIntoView({ block: "nearest" }));
    return Promise.resolve(false);
  }
  function move(memberId: string, to: string | null) {
    const from = snapshot?.memberLocations[memberId] ?? null;
    const key = to ?? from ?? "allocation";
    if (!snapshot || !canMoveMember(memberId, to)) return blocked(key);
    return send(key, `${path}/move`, { memberId, from, to, expectedVersion: snapshot.proposalVersion }, [from, to].filter((id): id is string => id !== null));
  }
  function swap(memberId: string, otherMemberId: string) {
    const from = snapshot?.memberLocations[memberId]; const to = snapshot?.memberLocations[otherMemberId];
    if (!snapshot || !from || !to || !canSwapMembers(memberId, otherMemberId)) return blocked(from ?? "allocation");
    return send(from, `${path}/swap`, { memberId, otherMemberId, from, to, expectedVersion: snapshot.proposalVersion }, [from, to]);
  }
  function action(name: string, extra: Record<string, unknown> = {}) {
    if (!snapshot) return Promise.resolve(false);
    return send(name, `${path}/${name}`, { expectedVersion: snapshot.proposalVersion, ...extra });
  }
  const active = snapshot && (snapshot.phase === "editing" || snapshot.phase === "submitted");
  return <section aria-label={t("title")} className="space-y-4" aria-busy={pending.length > 0}>
    <h2 className="text-lg font-semibold">{t("title")}</h2>
    {canCreate ? <div><button type="button" className={buttonClass} disabled={pending.length > 0} onClick={() => void send("create", "/api/support-teams/proposals", { expectedVersion: snapshot?.version ?? publishedVersion })}>{t("create")}</button>{errorNode("create")}</div> : null}
    {snapshot ? <>
      <div role="status" className="space-y-1">
        <p>{t("approvals", { approved: number(snapshot.approved), required: number(snapshot.required), total: number(snapshot.electorateCount) })}</p>
        <p className="text-sm text-hq-fg-muted">{t("majorityHint")}</p>
        {snapshot.invalidated ? <p>{t("invalidated")}</p> : null}
        {snapshot.stale ? <p>{root("supportTeams.changed")}</p> : null}
        {snapshot.identityReviewRequired ? <p>{root("supportTeams.history.dependencies")}</p> : null}
        {active && !snapshot.complete ? <p>{t("incomplete")}</p> : null}
      </div>
      {renderBoard ? <ProposalBoardContent renderBoard={renderBoard} adapter={{ snapshot, move, swap, canMoveMember, canSwapMembers, pendingTeamIds: [...new Set(pending.filter((key) => snapshot.teams.some((team) => team.id === key)))], errors, renderSlotControls: errorNode }} /> : null}
      {errorNode("allocation")}
      {active ? <div className="flex flex-wrap items-start gap-2">
        <div><button type="button" className={buttonClass} disabled={pending.length > 0 || !snapshot.canEdit || !snapshot.complete || (snapshot.phase === "submitted" && !snapshot.invalidated)} onClick={() => void action("submit")}>{t("submit")}</button>{errorNode("submit")}</div>
        <div><button type="button" className={buttonClass} disabled={pending.length > 0 || !snapshot.canApprove} onClick={() => void action("approve")}>{t("approve")}</button>{errorNode("approve")}</div>
        <div><button type="button" className={buttonClass} disabled={pending.length > 0 || !snapshot.canPublish} onClick={() => void action("publish", { expectedPublishedVersion: snapshot.publishedVersion, override: false })}>{t("publish")}</button>{errorNode("publish")}</div>
        {snapshot.canOverride ? <button type="button" className={buttonClass} disabled={pending.length > 0} onClick={() => setOverrideConfirmation(confirmationBasis)}>{t("override")}</button> : null}
        {snapshot.canCancel ? <div><button type="button" className={buttonClass} disabled={pending.length > 0} onClick={() => void action("cancel")}>{root("timeOff.officerModal.cancel")}</button>{errorNode("cancel")}</div> : null}
      </div> : null}
      {snapshot.canOverride && overrideConfirmation === confirmationBasis ? <div role="group" aria-label={t("overrideConfirm")} className="space-y-2">
        <p>{t("overrideConfirm")}</p>
        <button type="button" className={buttonClass} disabled={pending.length > 0} onClick={async () => { if (await action("publish", { expectedPublishedVersion: snapshot.publishedVersion, override: true })) setOverrideConfirmation(null); }}>{t("override")}</button>
        <button type="button" className={buttonClass} onClick={() => setOverrideConfirmation(null)}>{root("timeOff.officerModal.cancel")}</button>
      </div> : null}
    </> : null}
  </section>;
}
