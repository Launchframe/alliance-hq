"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { AppSelect } from "@/components/ui/AppSelect";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { AshedMember } from "@/lib/video/member-matcher";
import {
  EVENT_EVIDENCE_KINDS,
  type EventEvidenceKind,
} from "@/lib/hq-events/event-types.shared";

const KIND_LABEL_KEY: Record<EventEvidenceKind, string> = {
  leaderboard: "leaderboardEvidence",
  poll_yes: "pollYes",
  poll_no: "pollNo",
  legacy_leaderboard: "legacyLeaderboard",
};

const INTEGER_RE = /^\d+$/;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  boardId: string;
  onSaved: () => void;
};

/** Reviewed manual evidence batch; client requestId makes resubmits no-ops. */
export function ManualEvidenceDialog({
  open,
  onOpenChange,
  eventId,
  boardId,
  onSaved,
}: Props) {
  const t = useTranslations("eventEvidence");
  const tTrains = useTranslations("trains.wheel");
  const tMembers = useTranslations("members");
  const tVsErrors = useTranslations("vsPerformance.errors");
  const tActions = useTranslations("vsPerformance.actions");

  const [roster, setRoster] = useState<AshedMember[] | null>(null);
  const [rosterError, setRosterError] = useState(false);
  const [memberId, setMemberId] = useState("");
  const [kind, setKind] = useState<EventEvidenceKind>("leaderboard");
  const [score, setScore] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!open || roster != null) return;
    let cancelled = false;
    fetch("/api/members", { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error("load_failed");
        return body;
      })
      .then((body) => {
        if (!cancelled) setRoster(body?.members ?? []);
      })
      .catch(() => {
        if (!cancelled) setRosterError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, roster]);

  const memberOptions = useMemo(
    () =>
      (roster ?? []).map((member) => ({
        value: member.id,
        label: member.current_name,
        searchText: `${member.current_name} ${(member.previous_names ?? []).join(" ")}`,
      })),
    [roster],
  );

  const member = roster?.find((m) => m.id === memberId) ?? null;
  const needsScore = kind === "leaderboard";
  const scoreValid =
    !needsScore || (score !== "" && INTEGER_RE.test(score));
  const canSubmit =
    member != null &&
    scoreValid &&
    (!needsScore || INTEGER_RE.test(score)) &&
    (kind === "leaderboard" ? INTEGER_RE.test(score) : true) &&
    !pending;

  const submit = async () => {
    if (!member) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/hq-events/${eventId}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          boards: [
            {
              boardId,
              observations: [
                {
                  memberId: member.id,
                  memberName: member.current_name,
                  kind,
                  realScore: kind === "leaderboard" ? score : null,
                  provenance: "manual",
                  correctionReason: reason.trim() || null,
                },
              ],
            },
          ],
        }),
      });
      if (!res.ok) {
        setError(
          res.status === 403
            ? tVsErrors("forbidden")
            : t("actionFailed"),
        );
        return;
      }
      onSaved();
      onOpenChange(false);
      setMemberId("");
      setScore("");
      setReason("");
      setRequestId(crypto.randomUUID());
    } catch {
      setError(t("actionFailed"));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("manualEntry")}>
      <div className="space-y-4 p-1">
        {rosterError ? (
          <p role="alert" className="text-sm text-hq-danger">
            {t("actionFailed")}
          </p>
        ) : null}
        <div className="space-y-1">
          <AppSelect
            value={memberId}
            onChange={setMemberId}
            options={memberOptions}
            placeholder={t("matchedMember")}
            searchable
            searchPlaceholder={tMembers("search")}
            aria-label={t("matchedMember")}
          />
          {memberId && !member ? (
            <p className="text-xs text-hq-warning">{t("unmatchedMember")}</p>
          ) : null}
        </div>
        <AppSelect
          value={kind}
          onChange={(value) => setKind(value as EventEvidenceKind)}
          options={EVENT_EVIDENCE_KINDS.map((value) => ({
            value,
            label: t(KIND_LABEL_KEY[value]),
          }))}
          aria-label={t("evidenceSource")}
        />
        {needsScore ? (
          <input
            type="text"
            inputMode="numeric"
            value={score}
            onChange={(e) => setScore(e.target.value.trim())}
            placeholder={t("realScore")}
            aria-label={t("realScore")}
            aria-invalid={!scoreValid}
            className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
          />
        ) : null}
        <div className="space-y-1">
          <label className="text-xs text-hq-fg-muted" htmlFor="evidence-reason">
            {tTrains("overrideReasonLabel")}
          </label>
          <input
            id="evidence-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={tTrains("overrideReasonPlaceholder")}
            className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-hq-danger">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {tActions("cancel")}
          </Button>
          <Button
            type="button"
            disabled={!canSubmit || roster == null}
            onClick={() => void submit()}
          >
            {pending ? tActions("save") : tActions("save")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export { KIND_LABEL_KEY as EVIDENCE_KIND_LABEL_KEY };
