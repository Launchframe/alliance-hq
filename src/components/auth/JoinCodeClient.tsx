"use client";

import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { useShellNavigation } from "@/components/ashed-shell/useShellNavigation";
import {
  normalizeJoinCodeInput,
  SegmentedCodeInput,
} from "@/components/ui/SegmentedCodeInput";
import { preventDefaultFormSubmit } from "@/lib/client/form-enter-submit.shared";
import { extractHqInviteToken } from "@/lib/native-alliance/invite-token-from-input.shared";
import { resolveDiscordPostLinkOnboardingRedirect } from "@/lib/navigation/safe-redirect.shared";

type Props = {
  initialCode?: string;
  /** When false, omits the back link (e.g. embedded on Discord /link success). */
  showBackLink?: boolean;
  /** When false, omits the page title and intro (parent supplies context). */
  showHeader?: boolean;
  /** When true, omits outer card chrome (parent provides the shell). */
  embedded?: boolean;
  /** When set, overrides API redirect after successful redeem. */
  redirectToOverride?: string;
};

/**
 * Module-scoped so React remounts (Strict Mode / soft navigation) cannot
 * double-fire auto-redeem against single-use claim codes.
 */
const autoRedeemAttemptedCodes = new Set<string>();

export function JoinCodeClient({
  initialCode,
  showBackLink = true,
  showHeader = true,
  embedded = false,
  redirectToOverride,
}: Props) {
  const t = useTranslations("join");
  const { push, assign } = useShellNavigation();
  const hasInitialCode = Boolean(initialCode?.trim());
  const [code, setCode] = useState(initialCode ?? "");
  const [submitting, setSubmitting] = useState(hasInitialCode);
  const [error, setError] = useState<string | null>(null);
  const redeemInFlightRef = useRef(false);

  async function redeem(codeOverride?: string) {
    if (redeemInFlightRef.current) return;

    const trimmed = (codeOverride ?? code).trim();
    if (!trimmed) {
      setError(t("codeRequired"));
      return;
    }

    // Commander claim links (and other HQ invites) can be pasted here after
    // Discord `/link`. Send the user to the invite accept page, then onboard
    // for UID — claim invites auto-link without owner approval.
    const inviteToken = extractHqInviteToken(trimmed);
    if (inviteToken) {
      const next =
        redirectToOverride ?? resolveDiscordPostLinkOnboardingRedirect();
      push(
        `/invite/${encodeURIComponent(inviteToken)}?next=${encodeURIComponent(next)}`,
      );
      return;
    }

    redeemInFlightRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/join-codes/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });
      const body = (await res.json()) as {
        error?: string;
        redirectTo?: string;
      };
      if (!res.ok) {
        setError(body.error ?? t("redeemFailed"));
        return;
      }
      assign(redirectToOverride ?? body.redirectTo ?? "/dashboard", "joinCode");
      return;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("redeemFailed"));
    } finally {
      redeemInFlightRef.current = false;
      setSubmitting(false);
    }
  }

  // Share links (`/welcome?code=` → `/join?code=`) should skip the typed entry
  // step when the code is already in the URL.
  useEffect(() => {
    const trimmed = initialCode?.trim();
    if (!trimmed) return;
    const key = normalizeJoinCodeInput(trimmed);
    if (!key || autoRedeemAttemptedCodes.has(key)) return;
    autoRedeemAttemptedCodes.add(key);
    // Defer so setState inside redeem is not synchronous in the effect body
    // (react-hooks/set-state-in-effect). Module set already blocks remount doubles.
    queueMicrotask(() => {
      void redeem(trimmed);
    });
    // Intentionally once per URL-provided code (module set survives remount).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- auto-redeem on initialCode only
  }, [initialCode]);

  return (
    <div
      className={
        embedded
          ? "space-y-4"
          : "mx-auto max-w-md space-y-4 rounded-xl border border-hq-border bg-hq-surface p-6"
      }
    >
      {showBackLink ? (
        <Link
          href="/get-started"
          className="mb-2 flex items-center gap-1 self-start text-xs text-hq-fg-muted transition-colors hover:text-hq-fg"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
          {t("backToGetStarted")}
        </Link>
      ) : null}

      {showHeader ? (
        <>
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-hq-fg-muted">{t("body")}</p>
        </>
      ) : null}

      <form
        className="space-y-4"
        onSubmit={(event) => {
          preventDefaultFormSubmit(event);
          void redeem();
        }}
      >
        <div className="space-y-2">
          <label
            htmlFor="join-code-input"
            className="block text-sm text-hq-fg-muted"
          >
            {t("code")}
          </label>
          <SegmentedCodeInput
            id="join-code-input"
            value={code}
            onChange={setCode}
            onSubmit={() => void redeem()}
            autoFocus={!hasInitialCode}
          />
        </div>

        {error ? <p className="text-sm text-hq-danger">{error}</p> : null}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg border border-hq-success bg-hq-success px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {submitting ? t("redeeming") : t("redeem")}
        </button>
      </form>
    </div>
  );
}
