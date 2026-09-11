"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CopyToClipboardField } from "@/components/ui/CopyToClipboardField";
import { Link } from "@/i18n/navigation";
import type { SupportSnapshot } from "@/lib/support-teams/types.shared";
import { SupportClientError, supportRequest } from "@/lib/support-teams/board-client.shared";
import { SupportDialog, supportButton } from "./SupportTeamControls";

type ClaimResult = { targetAshedMemberId: string; targetCommanderName: string | null; code: string; welcomeUrl: string | null; welcomeUrlRequiresAllianceTag: boolean };
export function useSupportClaimInvites(snapshot: SupportSnapshot, allowed: boolean) {
  const t = useTranslations("team.invites");
  const help = useTranslations("memberLinkHelpRequests");
  const [claimable, setClaimable] = useState<string[]>([]);
  const [target, setTarget] = useState<string | null>(null);
  const [result, setResult] = useState<ClaimResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    if (!allowed) return;
    let active = true;
    void supportRequest<{ commanders: { ashedMemberId: string }[] }>("/api/settings/team/claimable-commanders").then((data) => { if (active) setClaimable(data.commanders.map((row) => row.ashedMemberId)); }).catch(() => { if (active) setClaimable([]); });
    return () => { active = false; };
  }, [allowed, snapshot.version]);
  const generate = async () => {
    if (!target || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const data = await supportRequest<{ created: ClaimResult[]; skipped: { ashedMemberId: string; code: string }[] }>("/api/settings/team/invites/bulk-claim", { method: "POST", body: JSON.stringify({ targetAshedMemberIds: [target] }) });
      const created = data.created.find((row) => row.targetAshedMemberId === target);
      if (!created) { setError(t(data.skipped.find((row) => row.ashedMemberId === target)?.code === "commander_already_claimed" ? "claimAlreadyClaimed" : "claimFailed")); setClaimable((old) => old.filter((id) => id !== target)); }
      else setResult(created);
    } catch (failure) { setError(failure instanceof SupportClientError && failure.status === 403 ? t("forbidden") : t("claimFailed")); }
    finally { lock.current = false; setBusy(false); }
  };
  const renderMemberActions = (id: string) => {
    const member = snapshot.roster.find((row) => row.id === id);
    if (!allowed || !member || member.hqLinked) return null;
    if (member.discordLinked) return <Link className={`${supportButton} mt-2 inline-block`} href="/members/member-link-help">{help("title")}</Link>;
    if (!claimable.includes(id)) return null;
    return <button type="button" className={`${supportButton} mt-2`} onClick={() => { setTarget(id); setResult(null); setError(""); }}>{t("claimRowAction")}</button>;
  };
  const dialog = target && <SupportDialog title={t("claimTitle")} onClose={() => { if (!busy) { setTarget(null); setResult(null); } }}>
    <p className="mb-3 font-semibold">{snapshot.roster.find((row) => row.id === target)?.name}</p>
    {!result && <button className={supportButton} disabled={busy} onClick={() => void generate()}>{t("claimButton")}</button>}
    {error && <p role="alert" className="mt-2 text-sm text-hq-danger">{error}</p>}
    {result && <div className="space-y-3"><p>{t("claimSentFor", { name: result.targetCommanderName ?? snapshot.roster.find((row) => row.id === target)?.name ?? "" })}</p>
      <CopyToClipboardField label={t("claimCodeLabel")} value={result.code} />
      {result.welcomeUrl && <CopyToClipboardField label={t("wizard.welcomeUrlLabel")} value={result.welcomeUrl} />}
      {result.welcomeUrlRequiresAllianceTag && <p>{t("wizard.welcomeUrlRequiresTag")}</p>}
      <p className="text-sm text-hq-fg-muted">{t("wizard.sharingReminderDm")}</p>
    </div>}
  </SupportDialog>;
  return { renderMemberActions, dialog };
}
