"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { AllianceWelcomeHero } from "@/components/onboarding/AllianceWelcomeHero";
import { PlayerUidBypassHint } from "@/components/onboarding/PlayerUidBypassHint";
import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";
import { fireCelebrationConfetti } from "@/lib/client/celebration-confetti";
import { isValidGameUid } from "@/lib/lastwar/player-lookup";
import type { MemberLinkOnboardingInitialState } from "@/lib/member-link/onboarding-bootstrap.shared";
import type { MemberLinkOutcome } from "@/lib/member-link/outcome.shared";
import { dispatchAllianceSetupStatusRefresh } from "@/lib/alliance-setup-guide-refresh.shared";
import { useShellNavigation } from "@/components/ashed-shell/useShellNavigation";
import { Link } from "@/i18n/navigation";

type Props = {
  allianceName: string;
  allianceTag: string;
  nextPath: string;
  /** Discord `/link` funnel: manual explore CTA instead of auto-redirect. */
  successPresentation?: "default" | "explore";
  /** Server-resolved first step — avoids welcome/confetti flash before claim or pending UI. */
  initialState?: MemberLinkOnboardingInitialState;
  /** HQ account already linked to Discord (`discord_hq_links`). */
  discordBotLinked?: boolean;
};

type Phase =
  | "welcome"
  | "form"
  | "walkthrough"
  | "fuzzy"
  | "roster_miss"
  | "awaiting_owner"
  | "wrong_server"
  | "confirm_server"
  | "lookup_fallback"
  | "confirm_identity"
  | "claim"
  | "success"
  | "profession";

type ApiResponse = {
  outcome: MemberLinkOutcome;
  message: string;
  candidates?: Array<{ memberId: string; name: string }>;
  linkedMemberName?: string;
  lookupGameUserName?: string;
  lookupServerNumber?: number | null;
  allianceServerNumber?: number | null;
  serverConfirmReason?: "missing" | "mismatch";
};

function ProfessionStep({ onComplete }: { onComplete: () => void }) {
  const t = useTranslations("onboard");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function chooseProfession(profession: "Engineer" | "War Leader") {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/professions/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toProfession: profession }),
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        setError(json.error ?? t("professionSaveFailed"));
        return;
      }
      onComplete();
    } catch {
      setError(t("professionSaveError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5 text-center">
      <div>
        <h2 className="text-xl font-semibold text-hq-fg">{t("professionStepTitle")}</h2>
        <p className="mt-1 text-sm text-hq-fg-muted">
          {t("professionStepSubtitle")}
        </p>
      </div>
      {error && <p className="text-sm text-hq-danger">{error}</p>}
      <div className="flex flex-col gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => void chooseProfession("Engineer")}
          className="w-full rounded-lg border border-hq-border bg-hq-surface px-4 py-3 text-left hover:border-hq-accent hover:bg-hq-surface-muted disabled:opacity-50"
        >
          <p className="font-semibold text-hq-fg">{t("professionEngineerTitle")}</p>
          <p className="mt-0.5 text-xs text-hq-fg-muted">
            {t("professionEngineerDesc")}
          </p>
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void chooseProfession("War Leader")}
          className="w-full rounded-lg border border-hq-border bg-hq-surface px-4 py-3 text-left hover:border-hq-accent hover:bg-hq-surface-muted disabled:opacity-50"
        >
          <p className="font-semibold text-hq-fg">{t("professionWarLeaderTitle")}</p>
          <p className="mt-0.5 text-xs text-hq-fg-muted">
            {t("professionWarLeaderDesc")}
          </p>
        </button>
      </div>
      <button
        type="button"
        disabled={saving}
        onClick={onComplete}
        className="text-xs text-hq-fg-muted hover:underline disabled:opacity-50"
      >
        {t("professionSkip")}
      </button>
    </div>
  );
}

export function MemberLinkOnboardingWizard({
  allianceName,
  allianceTag,
  nextPath,
  successPresentation = "default",
  initialState = { phase: "welcome" },
  discordBotLinked = false,
}: Props) {
  const t = useTranslations("onboard");
  const tLink = useTranslations("memberLink");
  const { pushAndRefresh } = useShellNavigation();

  const [phase, setPhase] = useState<Phase>(initialState.phase);
  const [reportedName, setReportedName] = useState("");
  const [gameUid, setGameUid] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<
    Array<{ memberId: string; name: string }>
  >(initialState.candidates ?? []);
  const [linkedName, setLinkedName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [serverDraft, setServerDraft] = useState("");
  const [serverConfirmReason, setServerConfirmReason] = useState<
    "missing" | "mismatch" | null
  >(null);
  const [lookupServerNumber, setLookupServerNumber] = useState<number | null>(
    null,
  );
  const [allianceServerNumber, setAllianceServerNumber] = useState<
    number | null
  >(null);
  const [useLookupFallback, setUseLookupFallback] = useState(false);
  const [claimCommanderName] = useState(
    initialState.claimCommanderName ?? "",
  );
  const [confirmName, setConfirmName] = useState<string | null>(null);

  const walkthroughSteps = useMemo(
    () => tLink.raw("steps") as string[],
    [tLink],
  );

  const goToMemberLinkForm = useCallback(() => {
    setPhase("form");
  }, []);

  const applyOutcome = useCallback(
    (data: ApiResponse) => {
      setMessage(data.message);
      switch (data.outcome) {
        case "linked":
          setLinkedName(data.linkedMemberName ?? reportedName);
          setPhase("success");
          dispatchAllianceSetupStatusRefresh();
          if (
            typeof window !== "undefined" &&
            !window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ) {
            fireCelebrationConfetti();
          }
          window.setTimeout(() => {
            setPhase("profession");
          }, 2000);
          break;
        case "walkthrough":
        case "walkthrough_done":
          setPhase(data.outcome === "walkthrough_done" ? "form" : "walkthrough");
          if (data.outcome === "walkthrough_done") {
            setMessage(data.message);
          }
          break;
        case "fuzzy_pick":
          setCandidates(data.candidates ?? []);
          setPhase("fuzzy");
          break;
        case "roster_miss":
          setPhase("roster_miss");
          break;
        case "awaiting_owner":
          setPhase("awaiting_owner");
          break;
        case "wrong_server":
          setPhase("wrong_server");
          setFormError(data.message);
          break;
        case "name_mismatch":
          setPhase("form");
          setFormError(data.message);
          break;
        case "confirm_server":
          setServerConfirmReason(data.serverConfirmReason ?? null);
          setLookupServerNumber(data.lookupServerNumber ?? null);
          setAllianceServerNumber(data.allianceServerNumber ?? null);
          setServerDraft(
            String(
              data.lookupServerNumber ??
                data.allianceServerNumber ??
                "",
            ),
          );
          setUseLookupFallback(false);
          setMessage(data.message);
          setPhase("confirm_server");
          break;
        case "lookup_fallback":
          setUseLookupFallback(true);
          setServerDraft("");
          setMessage(data.message);
          setPhase("lookup_fallback");
          break;
        case "member_taken":
          setPhase("form");
          setFormError(data.message?.trim() || t("memberTakenBody"));
          break;
        case "lookup_error":
        case "usage":
        case "pick_expired":
          setPhase("form");
          setFormError(data.message);
          break;
        case "officer_notified":
          setMessage(data.message);
          setPhase("form");
          break;
        default:
          setPhase("form");
          setFormError(data.message);
      }
    },
    [discordBotLinked, nextPath, pushAndRefresh, reportedName, successPresentation, t],
  );

  function buildSubmitBody(extra?: {
    ownerProvidedServerNumber?: number;
    ownerLookupFallback?: boolean;
  }) {
    return {
      reportedName: reportedName.trim(),
      gameUid: gameUid.trim(),
      ...extra,
    };
  }

  function parseServerDraft(): number | null {
    const trimmed = serverDraft.trim();
    if (!trimmed) return null;
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 9999) {
      return null;
    }
    return parsed;
  }

  async function postJson<T>(url: string, body?: unknown): Promise<T> {
    const res = await fetch(url, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json()) as T & { message?: string; outcome?: string };
    if (!res.ok) {
      throw new Error(t("requestFailed"));
    }
    return data as T;
  }

  async function submitPreview() {
    setFormError(null);
    const uid = gameUid.trim();
    if (!uid) {
      setFormError(t("uidRequired"));
      return;
    }
    if (!isValidGameUid(uid)) {
      setFormError(t("uidInvalid"));
      return;
    }

    setBusy(true);
    try {
      const data = await postJson<ApiResponse>("/api/member-link/preview", {
        gameUid: uid,
      });
      if (data.outcome === "confirm_identity") {
        setConfirmName(data.lookupGameUserName ?? null);
        setLookupServerNumber(data.lookupServerNumber ?? null);
        setMessage(null);
        setPhase("confirm_identity");
      } else {
        applyOutcome(data);
      }
    } catch {
      setFormError(t("requestFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function submitConfirmedLink() {
    setFormError(null);
    const uid = gameUid.trim();
    const name = confirmName?.trim();
    if (!name || !isValidGameUid(uid)) {
      setPhase("form");
      return;
    }

    // Carry the confirmed game name forward so downstream branches that re-read
    // reportedName (server-number confirm) keep working.
    setReportedName(name);
    setBusy(true);
    try {
      const data = await postJson<ApiResponse>("/api/member-link", {
        reportedName: name,
        gameUid: uid,
      });
      applyOutcome(data);
    } catch {
      setFormError(t("requestFailed"));
    } finally {
      setBusy(false);
    }
  }

  function reenterUid() {
    setConfirmName(null);
    setFormError(null);
    setPhase("form");
  }

  async function submitServerNumber() {
    setFormError(null);
    const server = parseServerDraft();
    if (server == null) {
      setFormError(
        serverDraft.trim() ? t("serverNumberInvalid") : t("serverNumberRequired"),
      );
      return;
    }

    const name = reportedName.trim();
    const uid = gameUid.trim();
    if (!name || !uid) {
      setFormError(t("requestFailed"));
      setPhase("form");
      return;
    }

    setBusy(true);
    try {
      const data = await postJson<ApiResponse>(
        "/api/member-link",
        buildSubmitBody({
          ownerProvidedServerNumber: server,
          ownerLookupFallback: useLookupFallback,
        }),
      );
      applyOutcome(data);
    } catch {
      setFormError(t("requestFailed"));
    } finally {
      setBusy(false);
    }
  }

  function backToLinkForm() {
    setUseLookupFallback(false);
    setServerConfirmReason(null);
    setFormError(null);
    setPhase("form");
  }

  async function walkthroughDone() {
    setBusy(true);
    try {
      const data = await postJson<ApiResponse>(
        "/api/member-link/walkthrough/done",
      );
      applyOutcome(data);
    } catch {
      setFormError(t("requestFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function startOver() {
    setBusy(true);
    try {
      const data = await postJson<ApiResponse>("/api/member-link/start-over");
      applyOutcome(data);
    } catch {
      setFormError(t("requestFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function wrongAlliance() {
    setBusy(true);
    setFormError(null);
    try {
      const res = await fetch("/api/onboarding/reset", { method: "POST" });
      if (!res.ok) {
        setFormError(t("requestFailed"));
        return;
      }
      pushAndRefresh("/get-started", "memberLink");
    } catch {
      setFormError(t("requestFailed"));
      setBusy(false);
    }
  }

  async function askOfficer() {
    setFormError(null);
    const name = reportedName.trim();
    const uid = gameUid.trim();
    if (!isValidGameUid(uid)) {
      setFormError(t("askOfficerNeedsUid"));
      return;
    }

    setBusy(true);
    try {
      const data = await postJson<ApiResponse>("/api/member-link/ask-officer", {
        gameUid: uid,
        ...(name ? { reportedName: name } : {}),
      });
      applyOutcome(data);
    } catch {
      setFormError(t("requestFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function submitClaim() {
    setFormError(null);
    const uid = gameUid.trim();
    if (!isValidGameUid(uid)) {
      setFormError(t("uidInvalid"));
      return;
    }

    setBusy(true);
    try {
      const data = await postJson<ApiResponse>("/api/member-link/claim", {
        gameUid: uid,
      });
      if (data.outcome === "linked") {
        applyOutcome(data);
      } else {
        setFormError(data.message);
      }
    } catch {
      setFormError(t("requestFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmPick(memberId: string) {
    setBusy(true);
    try {
      const data = await postJson<ApiResponse>("/api/member-link/confirm", {
        memberId,
      });
      applyOutcome(data);
    } catch {
      setFormError(t("requestFailed"));
    } finally {
      setBusy(false);
    }
  }

  const refreshMemberLinkStatus = useCallback(async (): Promise<boolean> => {
    const res = await fetch("/api/member-link");
    if (!res.ok) return false;
    const data = (await res.json()) as ApiResponse & {
      linked?: boolean;
      link?: { memberDisplayName?: string | null };
      pending?: { kind: string };
      message?: string;
    };
    if (data.linked) {
      applyOutcome({
        outcome: "linked",
        message: t("linkedTitle"),
        linkedMemberName:
          data.link?.memberDisplayName ?? linkedName ?? reportedName,
      });
      return true;
    }
    if (data.pending?.kind === "link_awaiting_owner") {
      setPhase("awaiting_owner");
      setMessage(data.message);
      return false;
    }
    return false;
  }, [applyOutcome, linkedName, reportedName, t]);

  useEffect(() => {
    if (phase !== "awaiting_owner") return undefined;
    const timer = window.setInterval(() => {
      void refreshMemberLinkStatus().catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [phase, refreshMemberLinkStatus]);

  return (
    <div className="mx-auto w-full max-w-lg space-y-6 rounded-xl border border-hq-border bg-hq-surface p-6">
      {phase === "welcome" ? (
        <>
          <AllianceWelcomeHero
            allianceName={allianceName}
            allianceTag={allianceTag}
            welcomePrefix={t("welcomePrefix")}
          />
          <p className="text-center text-sm text-hq-fg-muted">{t("welcomeSubtitle")}</p>
          <button
            type="button"
            onClick={goToMemberLinkForm}
            className="w-full rounded-lg border border-hq-success bg-hq-success px-4 py-2.5 text-sm font-medium text-white"
          >
            {t("continue")}
          </button>
        </>
      ) : null}

      {phase === "form" ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            preventDefaultFormSubmit(event);
            void submitPreview();
          }}
        >
          <div>
            <h2 className="text-lg font-semibold">{t("title")}</h2>
            <p className="mt-1 text-sm text-hq-fg-muted">{t("uidOnlySubtitle")}</p>
          </div>
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t("uidLabel")}</span>
            <input
              type="text"
              inputMode="numeric"
              value={gameUid}
              onChange={(e) => setGameUid(e.target.value.replace(/\D/g, ""))}
              enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
              className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 font-mono text-sm text-hq-fg"
              autoComplete="off"
            />
            <span className="text-xs text-hq-fg-muted">{t("uidHint")}</span>
          </label>
          <PlayerUidBypassHint onSelectUid={setGameUid} />
          {formError ? (
            <p className="text-sm text-hq-danger">{formError}</p>
          ) : null}
          {message && !formError ? (
            <p className="text-sm text-hq-green">{message}</p>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg border border-hq-success bg-hq-success px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? t("submitting") : t("submit")}
          </button>
          <div className="space-y-2 rounded-lg border border-hq-border bg-hq-canvas p-3">
            <p className="text-xs text-hq-fg-muted">{t("linkHelpHint")}</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void askOfficer()}
              className="w-full rounded-lg border border-hq-danger-emphasis bg-hq-danger-emphasis/20 px-4 py-2.5 text-sm font-medium text-[#ff7b72] disabled:opacity-50"
            >
              {tLink("buttons.askOfficer")}
            </button>
          </div>
          <div className="border-t border-hq-border pt-3 text-center">
            <button
              type="button"
              disabled={busy}
              onClick={() => void wrongAlliance()}
              className="text-sm text-hq-fg-muted underline hover:text-hq-accent disabled:opacity-50"
            >
              {t("wrongAlliance")}
            </button>
            <p className="mt-1 text-xs text-hq-fg-muted">{t("wrongAllianceHint")}</p>
            <p className="mt-1 text-xs text-hq-fg-muted">{t("wrongAccountHint")}</p>
          </div>
        </form>
      ) : null}

      {phase === "walkthrough" ? (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">{t("walkthroughTitle")}</h2>
          {message ? (
            <pre className="whitespace-pre-wrap rounded-lg border border-hq-border bg-hq-canvas p-3 text-sm text-hq-fg">
              {message}
            </pre>
          ) : (
            <ol className="list-decimal space-y-2 pl-5 text-sm text-[#c9d1d9]">
              {walkthroughSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={busy}
              onClick={() => void walkthroughDone()}
              className="w-full rounded-lg border border-[#388bfd] bg-[#388bfd] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {tLink("buttons.done")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void askOfficer()}
              className="w-full rounded-lg border border-hq-danger-emphasis bg-hq-danger-emphasis/20 px-4 py-2.5 text-sm font-medium text-[#ff7b72] disabled:opacity-50"
            >
              {tLink("buttons.askOfficer")}
            </button>
          </div>
        </div>
      ) : null}

      {phase === "fuzzy" ? (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">{t("fuzzyTitle")}</h2>
          {message ? (
            <p className="text-sm text-hq-fg-muted">{message}</p>
          ) : null}
          <ul className="space-y-2">
            {candidates.map((c) => (
              <li key={c.memberId}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void confirmPick(c.memberId)}
                  className="w-full rounded-lg border border-hq-border bg-hq-canvas px-4 py-3 text-left text-sm font-medium text-hq-fg hover:border-hq-accent disabled:opacity-50"
                >
                  {c.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {phase === "roster_miss" ? (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">{t("rosterMissTitle")}</h2>
          <p className="text-sm text-hq-fg-muted">{message}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={busy}
              onClick={() => void startOver()}
              className="w-full rounded-lg border border-hq-border bg-hq-canvas px-4 py-2.5 text-sm font-medium text-hq-fg disabled:opacity-50"
            >
              {tLink("buttons.startOver")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void askOfficer()}
              className="w-full rounded-lg border border-hq-danger-emphasis bg-hq-danger-emphasis/20 px-4 py-2.5 text-sm font-medium text-[#ff7b72] disabled:opacity-50"
            >
              {tLink("buttons.askOfficer")}
            </button>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void wrongAlliance()}
            className="w-full text-sm text-hq-fg-muted underline hover:text-hq-accent disabled:opacity-50"
          >
            {t("wrongAlliance")}
          </button>
        </div>
      ) : null}

      {phase === "awaiting_owner" ? (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">{t("awaitingOwnerTitle")}</h2>
          <p className="text-sm text-hq-fg-muted">{message ?? t("awaitingOwnerBody")}</p>
          <p className="text-xs text-hq-fg-subtle">{t("awaitingOwnerHint")}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void refreshMemberLinkStatus()}
            className="w-full rounded-lg border border-hq-border bg-hq-canvas px-4 py-2.5 text-sm font-medium text-hq-fg disabled:opacity-50"
          >
            {t("awaitingOwnerRefresh")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void startOver()}
            className="w-full rounded-lg border border-hq-border bg-hq-canvas px-4 py-2.5 text-sm font-medium text-hq-fg disabled:opacity-50"
          >
            {tLink("buttons.startOver")}
          </button>
        </div>
      ) : null}

      {phase === "wrong_server" ? (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">{t("wrongServerTitle")}</h2>
          <p className="text-sm text-hq-danger">{formError ?? message}</p>
          <p className="text-sm text-hq-fg-muted">{t("wrongServerBody")}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void wrongAlliance()}
            className="w-full text-sm text-hq-fg-muted underline hover:text-hq-accent disabled:opacity-50"
          >
            {t("wrongAlliance")}
          </button>
        </div>
      ) : null}

      {phase === "confirm_server" || phase === "lookup_fallback" ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            preventDefaultFormSubmit(event);
            void submitServerNumber();
          }}
        >
          <h2 className="text-lg font-semibold">
            {phase === "lookup_fallback"
              ? t("lookupFallbackTitle")
              : t("confirmServerTitle")}
          </h2>
          <p className="text-sm text-hq-fg-muted">
            {message ??
              (phase === "lookup_fallback"
                ? t("lookupFallbackBody")
                : serverConfirmReason === "mismatch"
                  ? t("confirmServerMismatchBody")
                  : t("confirmServerMissingBody"))}
          </p>
          {serverConfirmReason === "mismatch" ? (
            <dl className="grid grid-cols-2 gap-2 rounded-lg border border-hq-border bg-hq-canvas p-3 text-sm">
              <div>
                <dt className="text-hq-fg-muted">Last War</dt>
                <dd className="font-medium text-hq-fg">
                  {lookupServerNumber ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-hq-fg-muted">{t("serverNumberLabel")}</dt>
                <dd className="font-medium text-hq-fg">
                  {allianceServerNumber ?? "—"}
                </dd>
              </div>
            </dl>
          ) : null}
          {phase === "lookup_fallback" ? (
            <label className="block space-y-1">
              <span className="text-sm font-medium">{t("nameLabel")}</span>
              <input
                type="text"
                value={reportedName}
                onChange={(e) => setReportedName(e.target.value)}
                className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
                autoComplete="off"
              />
              <span className="text-xs text-hq-fg-muted">{t("nameHint")}</span>
            </label>
          ) : null}
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t("serverNumberLabel")}</span>
            <input
              type="text"
              inputMode="numeric"
              value={serverDraft}
              onChange={(e) =>
                setServerDraft(e.target.value.replace(/\D/g, ""))
              }
              enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
              className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 font-mono text-sm text-hq-fg"
              autoComplete="off"
            />
            <span className="text-xs text-hq-fg-muted">{t("serverNumberHint")}</span>
          </label>
          {formError ? (
            <p className="text-sm text-hq-danger">{formError}</p>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg border border-hq-success bg-hq-success px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? t("submitting") : t("submitServer")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={backToLinkForm}
            className="w-full text-sm text-hq-fg-muted underline hover:text-hq-accent disabled:opacity-50"
          >
            {t("backToForm")}
          </button>
        </form>
      ) : null}

      {phase === "confirm_identity" ? (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">{t("confirmIdentityTitle")}</h2>
            <p className="mt-1 text-sm text-hq-fg-muted">
              {t("confirmIdentityBody")}
            </p>
          </div>
          <div className="rounded-lg border border-hq-border bg-hq-canvas p-4 text-center">
            <p className="text-xl font-semibold text-hq-fg">
              {confirmName ?? "—"}
            </p>
            {lookupServerNumber != null ? (
              <p className="mt-1 text-xs text-hq-fg-muted">
                {t("confirmIdentityServer", { server: lookupServerNumber })}
              </p>
            ) : null}
          </div>
          {formError ? (
            <p className="text-sm text-hq-danger">{formError}</p>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void submitConfirmedLink()}
            className="w-full rounded-lg border border-hq-success bg-hq-success px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? t("submitting") : t("confirmIdentityYes")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={reenterUid}
            className="w-full text-sm text-hq-fg-muted underline hover:text-hq-accent disabled:opacity-50"
          >
            {t("confirmIdentityNo")}
          </button>
        </div>
      ) : null}

      {phase === "claim" ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            preventDefaultFormSubmit(event);
            void submitClaim();
          }}
        >
          <div>
            <h2 className="text-lg font-semibold">{t("claimTitle")}</h2>
            <p className="mt-1 text-sm text-hq-fg-muted">
              {t("claimSubtitle", { name: claimCommanderName })}
            </p>
          </div>
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t("uidLabel")}</span>
            <input
              type="text"
              inputMode="numeric"
              value={gameUid}
              onChange={(e) => setGameUid(e.target.value.replace(/\D/g, ""))}
              enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
              className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 font-mono text-sm text-hq-fg"
              autoComplete="off"
            />
            <span className="text-xs text-hq-fg-muted">{t("uidHint")}</span>
          </label>
          <PlayerUidBypassHint onSelectUid={setGameUid} />
          {formError ? (
            <p className="text-sm text-hq-danger">{formError}</p>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg border border-hq-success bg-hq-success px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? t("submitting") : t("claimSubmit")}
          </button>
        </form>
      ) : null}

      {phase === "profession" ? (
        <ProfessionStep
          onComplete={() => pushAndRefresh(nextPath, "memberLink")}
        />
      ) : null}

      {phase === "success" ? (
        <div className="space-y-4 text-center">
          <h2 className="text-xl font-semibold text-hq-green">
            {t("linkedTitle")}
          </h2>
          <p className="text-sm text-hq-fg-muted">
            {successPresentation === "explore"
              ? t("linkedExploreBody", { name: linkedName ?? reportedName })
              : t("linkedBody", { name: linkedName ?? reportedName })}
          </p>
          {discordBotLinked ? (
            <p
              className="rounded-lg border border-hq-discord/35 bg-hq-discord/10 px-3 py-2.5 text-sm leading-snug text-hq-fg"
              role="status"
            >
              {t("linkedDiscordBotReady")}
            </p>
          ) : (
            <div className="space-y-3 text-left">
              <p className="text-sm text-hq-fg-muted">{t("linkedDiscordLinkPrompt")}</p>
              <Link
                href="/settings/account"
                className="inline-block rounded-lg border border-hq-discord bg-hq-discord px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                {t("linkedDiscordLinkCta")}
              </Link>
            </div>
          )}
          {successPresentation === "explore" || !discordBotLinked ? (
            <>
              <Link
                href={nextPath}
                className="inline-block rounded-lg border border-hq-success bg-hq-success px-4 py-2 text-sm font-medium text-white hover:bg-hq-success-hover"
              >
                {successPresentation === "explore"
                  ? t("linkedExploreCta")
                  : t("linkedContinueCta")}
              </Link>
              {successPresentation === "explore" ? (
                <p className="text-xs text-hq-fg-muted">{t("linkedExploreDismiss")}</p>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-hq-fg-muted">{t("linkedDiscordRedirectHint")}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
