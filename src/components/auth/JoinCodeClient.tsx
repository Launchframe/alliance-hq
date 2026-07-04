"use client";

import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { Link, useRouter } from "@/i18n/navigation";
import { SegmentedCodeInput } from "@/components/ui/SegmentedCodeInput";
import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";
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

export function JoinCodeClient({
  initialCode,
  showBackLink = true,
  showHeader = true,
  embedded = false,
  redirectToOverride,
}: Props) {
  const t = useTranslations("join");
  const router = useRouter();
  const [code, setCode] = useState(initialCode ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function redeem() {
    const trimmed = code.trim();
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
      router.push(
        `/invite/${encodeURIComponent(inviteToken)}?next=${encodeURIComponent(next)}`,
      );
      return;
    }

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
      router.push(redirectToOverride ?? body.redirectTo ?? "/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("redeemFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className={
        embedded
          ? "space-y-4"
          : "mx-auto max-w-md space-y-4 rounded-xl border border-[#30363d] bg-[#161b22] p-6"
      }
    >
      {showBackLink ? (
        <Link
          href="/get-started"
          className="mb-2 flex items-center gap-1 self-start text-xs text-[#8b949e] transition-colors hover:text-[#e6edf3]"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
          {t("backToGetStarted")}
        </Link>
      ) : null}

      {showHeader ? (
        <>
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-[#8b949e]">{t("body")}</p>
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
            className="block text-sm text-[#8b949e]"
          >
            {t("code")}
          </label>
          <SegmentedCodeInput
            id="join-code-input"
            value={code}
            onChange={setCode}
            onSubmit={() => void redeem()}
            aria-label={t("code")}
            autoFocus={!initialCode}
          />
        </div>

        {error ? <p className="text-sm text-[#f85149]">{error}</p> : null}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {submitting ? t("redeeming") : t("redeem")}
        </button>
      </form>
    </div>
  );
}
