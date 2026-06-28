"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { AllianceWelcomeHero } from "@/components/onboarding/AllianceWelcomeHero";
import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";
import { fireCelebrationConfetti } from "@/lib/client/celebration-confetti";
import { isValidGameUid } from "@/lib/lastwar/player-lookup";
import type { MemberLinkOutcome } from "@/lib/member-link/outcome.shared";
import { Link, useRouter } from "@/i18n/navigation";

type Props = {
  allianceName: string;
  allianceTag: string;
  nextPath: string;
  /** Discord `/link` funnel: manual explore CTA instead of auto-redirect. */
  successPresentation?: "default" | "explore";
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
  | "claim"
  | "success";

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

export function MemberLinkOnboardingWizard({
  allianceName,
  allianceTag,
  nextPath,
  successPresentation = "default",
}: Props) {
  const t = useTranslations("onboard");
  const tLink = useTranslations("memberLink");
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("welcome");
  const [reportedName, setReportedName] = useState("");
  const [gameUid, setGameUid] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<
    Array<{ memberId: string; name: string }>
  >([]);
  const [linkedName, setLinkedName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [suggestedName, setSuggestedName] = useState<string | null>(null);
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
  const [claimCommanderName, setClaimCommanderName] = useState("");

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
          if (
            typeof window !== "undefined" &&
            !window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ) {
            fireCelebrationConfetti();
          }
          if (successPresentation === "default") {
            window.setTimeout(() => {
              router.push(nextPath);
              router.refresh();
            }, 1800);
          }
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
          setSuggestedName(data.lookupGameUserName ?? null);
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
          setFormError(t("memberTakenBody"));
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
    [nextPath, reportedName, router, successPresentation, t],
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

  async function submitLink() {
    setFormError(null);
    const name = reportedName.trim();
    const uid = gameUid.trim();
    if (!name) {
      setFormError(t("nameRequired"));
      return;
    }
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
      const data = await postJson<ApiResponse>(
        "/api/member-link",
        buildSubmitBody(),
      );
      applyOutcome(data);
    } catch {
      setFormError(t("requestFailed"));
    } finally {
      setBusy(false);
    }
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

  function applySuggestedName() {
    if (!suggestedName) return;
    setReportedName(suggestedName);
    setSuggestedName(null);
    setFormError(null);
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
      router.push("/get-started");
      router.refresh();
    } catch {
      setFormError(t("requestFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function askOfficer() {
    setFormError(null);
    const uid = gameUid.trim();
    if (!isValidGameUid(uid)) {
      setFormError(t("askOfficerNeedsUid"));
      return;
    }

    setBusy(true);
    try {
      const data = await postJson<ApiResponse>("/api/member-link/ask-officer", {
        reportedName: reportedName.trim() || undefined,
        gameUid: uid,
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
    void fetch("/api/member-link")
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (data: {
          pending?: { kind: string; candidates?: Array<{ memberId: string; name: string }> } | null;
          claimTarget?: { ashedMemberId: string; commanderName: string } | null;
          message?: string | null;
        } | null) => {
          if (!data) return;
          if (data.pending) {
            if (data.pending.kind === "link_walkthrough") {
              setPhase("walkthrough");
            } else if (data.pending.kind === "link_fuzzy_pick") {
              setCandidates(data.pending.candidates ?? []);
              setPhase("fuzzy");
            } else if (data.pending.kind === "link_roster_miss") {
              setPhase("roster_miss");
            } else if (data.pending.kind === "link_awaiting_owner") {
              setPhase("awaiting_owner");
              setMessage(data.message ?? null);
            }
            return;
          }
          if (data.claimTarget?.commanderName) {
            setClaimCommanderName(data.claimTarget.commanderName);
            setPhase("claim");
          }
        },
      )
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (phase !== "awaiting_owner") return undefined;
    const timer = window.setInterval(() => {
      void refreshMemberLinkStatus().catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [phase, refreshMemberLinkStatus]);

  return (
    <div className="mx-auto w-full max-w-lg space-y-6 rounded-xl border border-[#30363d] bg-[#161b22] p-6">
      {phase === "welcome" ? (
        <>
          <AllianceWelcomeHero
            allianceName={allianceName}
            allianceTag={allianceTag}
            welcomePrefix={t("welcomePrefix")}
          />
          <p className="text-center text-sm text-[#8b949e]">{t("welcomeSubtitle")}</p>
          <button
            type="button"
            onClick={goToMemberLinkForm}
            className="w-full rounded-lg border border-[#238636] bg-[#238636] px-4 py-2.5 text-sm font-medium text-white"
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
            void submitLink();
          }}
        >
          <div>
            <h2 className="text-lg font-semibold">{t("title")}</h2>
            <p className="mt-1 text-sm text-[#8b949e]">{t("welcomeSubtitle")}</p>
          </div>
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t("nameLabel")}</span>
            <input
              type="text"
              value={reportedName}
              onChange={(e) => setReportedName(e.target.value)}
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-[#e6edf3]"
              autoComplete="off"
            />
            <span className="text-xs text-[#8b949e]">{t("nameHint")}</span>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t("uidLabel")}</span>
            <input
              type="text"
              inputMode="numeric"
              value={gameUid}
              onChange={(e) => setGameUid(e.target.value.replace(/\D/g, ""))}
              enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 font-mono text-sm text-[#e6edf3]"
              autoComplete="off"
            />
            <span className="text-xs text-[#8b949e]">{t("uidHint")}</span>
          </label>
          {formError ? (
            <p className="text-sm text-[#f85149]">{formError}</p>
          ) : null}
          {suggestedName ? (
            <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-3 text-sm text-[#c9d1d9]">
              <p className="text-[#8b949e]">{t("nameMismatchHint")}</p>
              <button
                type="button"
                disabled={busy}
                onClick={applySuggestedName}
                className="mt-2 text-[#58a6ff] underline hover:text-[#79c0ff] disabled:opacity-50"
              >
                {t("useSuggestedName")}: {suggestedName}
              </button>
            </div>
          ) : null}
          {message && !formError ? (
            <p className="text-sm text-[#3fb950]">{message}</p>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg border border-[#238636] bg-[#238636] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? t("submitting") : t("submit")}
          </button>
          <div className="space-y-2 rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
            <p className="text-xs text-[#8b949e]">{t("linkHelpHint")}</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void askOfficer()}
              className="w-full rounded-lg border border-[#da3633] bg-[#da3633]/20 px-4 py-2.5 text-sm font-medium text-[#ff7b72] disabled:opacity-50"
            >
              {tLink("buttons.askOfficer")}
            </button>
          </div>
          <div className="border-t border-[#30363d] pt-3 text-center">
            <button
              type="button"
              disabled={busy}
              onClick={() => void wrongAlliance()}
              className="text-sm text-[#8b949e] underline hover:text-[#58a6ff] disabled:opacity-50"
            >
              {t("wrongAlliance")}
            </button>
            <p className="mt-1 text-xs text-[#8b949e]">{t("wrongAllianceHint")}</p>
          </div>
        </form>
      ) : null}

      {phase === "walkthrough" ? (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">{t("walkthroughTitle")}</h2>
          {message ? (
            <pre className="whitespace-pre-wrap rounded-lg border border-[#30363d] bg-[#0d1117] p-3 text-sm text-[#e6edf3]">
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
              className="w-full rounded-lg border border-[#da3633] bg-[#da3633]/20 px-4 py-2.5 text-sm font-medium text-[#ff7b72] disabled:opacity-50"
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
            <p className="text-sm text-[#8b949e]">{message}</p>
          ) : null}
          <ul className="space-y-2">
            {candidates.map((c) => (
              <li key={c.memberId}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void confirmPick(c.memberId)}
                  className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-4 py-3 text-left text-sm font-medium text-[#e6edf3] hover:border-[#58a6ff] disabled:opacity-50"
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
          <p className="text-sm text-[#8b949e]">{message}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={busy}
              onClick={() => void startOver()}
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-4 py-2.5 text-sm font-medium text-[#e6edf3] disabled:opacity-50"
            >
              {tLink("buttons.startOver")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void askOfficer()}
              className="w-full rounded-lg border border-[#da3633] bg-[#da3633]/20 px-4 py-2.5 text-sm font-medium text-[#ff7b72] disabled:opacity-50"
            >
              {tLink("buttons.askOfficer")}
            </button>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void wrongAlliance()}
            className="w-full text-sm text-[#8b949e] underline hover:text-[#58a6ff] disabled:opacity-50"
          >
            {t("wrongAlliance")}
          </button>
        </div>
      ) : null}

      {phase === "awaiting_owner" ? (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">{t("awaitingOwnerTitle")}</h2>
          <p className="text-sm text-[#8b949e]">{message ?? t("awaitingOwnerBody")}</p>
          <p className="text-xs text-[#6e7681]">{t("awaitingOwnerHint")}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void refreshMemberLinkStatus()}
            className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-4 py-2.5 text-sm font-medium text-[#e6edf3] disabled:opacity-50"
          >
            {t("awaitingOwnerRefresh")}
          </button>
        </div>
      ) : null}

      {phase === "wrong_server" ? (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">{t("wrongServerTitle")}</h2>
          <p className="text-sm text-[#f85149]">{formError ?? message}</p>
          <p className="text-sm text-[#8b949e]">{t("wrongServerBody")}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void wrongAlliance()}
            className="w-full text-sm text-[#8b949e] underline hover:text-[#58a6ff] disabled:opacity-50"
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
          <p className="text-sm text-[#8b949e]">
            {message ??
              (phase === "lookup_fallback"
                ? t("lookupFallbackBody")
                : serverConfirmReason === "mismatch"
                  ? t("confirmServerMismatchBody")
                  : t("confirmServerMissingBody"))}
          </p>
          {serverConfirmReason === "mismatch" ? (
            <dl className="grid grid-cols-2 gap-2 rounded-lg border border-[#30363d] bg-[#0d1117] p-3 text-sm">
              <div>
                <dt className="text-[#8b949e]">Last War</dt>
                <dd className="font-medium text-[#e6edf3]">
                  {lookupServerNumber ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[#8b949e]">{t("serverNumberLabel")}</dt>
                <dd className="font-medium text-[#e6edf3]">
                  {allianceServerNumber ?? "—"}
                </dd>
              </div>
            </dl>
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
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 font-mono text-sm text-[#e6edf3]"
              autoComplete="off"
            />
            <span className="text-xs text-[#8b949e]">{t("serverNumberHint")}</span>
          </label>
          {formError ? (
            <p className="text-sm text-[#f85149]">{formError}</p>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg border border-[#238636] bg-[#238636] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? t("submitting") : t("submitServer")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={backToLinkForm}
            className="w-full text-sm text-[#8b949e] underline hover:text-[#58a6ff] disabled:opacity-50"
          >
            {t("backToForm")}
          </button>
        </form>
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
            <p className="mt-1 text-sm text-[#8b949e]">
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
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 font-mono text-sm text-[#e6edf3]"
              autoComplete="off"
            />
            <span className="text-xs text-[#8b949e]">{t("uidHint")}</span>
          </label>
          {formError ? (
            <p className="text-sm text-[#f85149]">{formError}</p>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg border border-[#238636] bg-[#238636] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? t("submitting") : t("claimSubmit")}
          </button>
        </form>
      ) : null}

      {phase === "success" ? (
        <div className="space-y-4 text-center">
          <h2 className="text-xl font-semibold text-[#3fb950]">
            {t("linkedTitle")}
          </h2>
          <p className="text-sm text-[#8b949e]">
            {successPresentation === "explore"
              ? t("linkedExploreBody", { name: linkedName ?? reportedName })
              : t("linkedBody", { name: linkedName ?? reportedName })}
          </p>
          {successPresentation === "explore" ? (
            <>
              <Link
                href={nextPath}
                className="inline-block rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm font-medium text-white hover:bg-[#2ea043]"
              >
                {t("linkedExploreCta")}
              </Link>
              <p className="text-xs text-[#8b949e]">{t("linkedExploreDismiss")}</p>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
