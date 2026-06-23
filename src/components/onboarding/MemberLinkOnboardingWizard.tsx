"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { AllianceWelcomeHero } from "@/components/onboarding/AllianceWelcomeHero";
import { fireCelebrationConfetti } from "@/lib/client/celebration-confetti";
import { isValidGameUid } from "@/lib/lastwar/player-lookup";
import type { MemberLinkOutcome } from "@/lib/member-link/outcome.shared";
import { useRouter } from "@/i18n/navigation";

import { Link } from "@/i18n/navigation";

type Props = {
  allianceName: string;
  allianceTag: string;
  nextPath: string;
  requiresAshedVerification?: boolean;
  isAshedConnected?: boolean;
};

type Phase =
  | "welcome"
  | "connect_ashed"
  | "form"
  | "walkthrough"
  | "fuzzy"
  | "roster_miss"
  | "success";

type ApiResponse = {
  outcome: MemberLinkOutcome | "ashed_verification_required";
  message: string;
  candidates?: Array<{ memberId: string; name: string }>;
  linkedMemberName?: string;
};

export function MemberLinkOnboardingWizard({
  allianceName,
  allianceTag,
  nextPath,
  requiresAshedVerification = false,
  isAshedConnected = false,
}: Props) {
  const t = useTranslations("onboard");
  const tLink = useTranslations("memberLink");
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>(() =>
    requiresAshedVerification && !isAshedConnected ? "connect_ashed" : "welcome",
  );
  const [reportedName, setReportedName] = useState("");
  const [gameUid, setGameUid] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<
    Array<{ memberId: string; name: string }>
  >([]);
  const [linkedName, setLinkedName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const walkthroughSteps = useMemo(
    () => tLink.raw("steps") as string[],
    [tLink],
  );

  const connectReturnPath = `/onboard?next=${encodeURIComponent(nextPath)}`;

  const goToMemberLinkForm = useCallback(() => {
    if (requiresAshedVerification && !isAshedConnected) {
      setPhase("connect_ashed");
      return;
    }
    setPhase("form");
  }, [isAshedConnected, requiresAshedVerification]);

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
          window.setTimeout(() => {
            router.push(nextPath);
            router.refresh();
          }, 1800);
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
        case "ashed_verification_required":
          setPhase("connect_ashed");
          setFormError(data.message);
          break;
        case "member_taken":
        case "lookup_error":
        case "usage":
        case "pick_expired":
          setPhase("form");
          setFormError(data.message);
          break;
        case "officer_notified":
          setMessage(data.message);
          break;
        default:
          setPhase("form");
          setFormError(data.message);
      }
    },
    [nextPath, reportedName, router],
  );

  async function postJson<T>(url: string, body?: unknown): Promise<T> {
    const res = await fetch(url, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json()) as T & { message?: string; outcome?: string };
    if (!res.ok) {
      if (
        res.status === 403 &&
        (data as { outcome?: string }).outcome === "ashed_verification_required"
      ) {
        return data as T;
      }
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
      setPhase("walkthrough");
    } catch {
      setFormError(t("requestFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function askOfficer() {
    setBusy(true);
    try {
      const data = await postJson<ApiResponse>("/api/member-link/ask-officer");
      applyOutcome(data);
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

  useEffect(() => {
    void fetch("/api/member-link")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.requiresAshedVerification && !isAshedConnected) {
          setPhase("connect_ashed");
          return;
        }
        if (!data?.pending) return;
        if (data.pending.kind === "link_walkthrough") {
          setPhase("walkthrough");
        } else if (data.pending.kind === "link_fuzzy_pick") {
          setCandidates(data.pending.candidates ?? []);
          setPhase("fuzzy");
        } else if (data.pending.kind === "link_roster_miss") {
          setPhase("roster_miss");
        }
      })
      .catch(() => undefined);
  }, [isAshedConnected]);

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

      {phase === "connect_ashed" ? (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">{t("connectAshedTitle")}</h2>
          <p className="text-sm text-[#8b949e]">{t("connectAshedBody")}</p>
          {formError ? (
            <p className="text-sm text-[#f85149]">{formError}</p>
          ) : null}
          <Link
            href={`/connect?next=${encodeURIComponent(connectReturnPath)}`}
            className="inline-flex w-full items-center justify-center rounded-lg border border-[#388bfd] bg-[#388bfd] px-4 py-2.5 text-sm font-medium text-white"
          >
            {t("connectAshedCta")}
          </Link>
        </div>
      ) : null}

      {phase === "form" ? (
        <div className="space-y-4">
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
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 font-mono text-sm text-[#e6edf3]"
              autoComplete="off"
            />
            <span className="text-xs text-[#8b949e]">{t("uidHint")}</span>
          </label>
          {formError ? (
            <p className="text-sm text-[#f85149]">{formError}</p>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void submitLink()}
            className="w-full rounded-lg border border-[#238636] bg-[#238636] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? t("submitting") : t("submit")}
          </button>
        </div>
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
          <button
            type="button"
            disabled={busy}
            onClick={() => void walkthroughDone()}
            className="w-full rounded-lg border border-[#388bfd] bg-[#388bfd] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {tLink("buttons.done")}
          </button>
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
        </div>
      ) : null}

      {phase === "success" ? (
        <div className="space-y-3 text-center">
          <h2 className="text-xl font-semibold text-[#3fb950]">
            {t("linkedTitle")}
          </h2>
          <p className="text-sm text-[#8b949e]">
            {t("linkedBody", { name: linkedName ?? reportedName })}
          </p>
        </div>
      ) : null}
    </div>
  );
}
