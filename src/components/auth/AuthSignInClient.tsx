"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

type Props = {
  callbackUrl?: string;
  presetEmail?: string;
};

export function AuthSignInClient({ callbackUrl, presetEmail }: Props) {
  const t = useTranslations("auth");
  const [email, setEmail] = useState(presetEmail ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendMagicLink() {
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError(t("emailRequired"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await signIn("resend", {
        email: trimmed,
        redirect: false,
        callbackUrl: callbackUrl ?? "/get-started",
      });
      if (result?.error) {
        setError(t("sendFailed"));
        return;
      }
      const params = new URLSearchParams({ email: trimmed });
      if (callbackUrl) {
        params.set("callbackUrl", callbackUrl);
      }
      window.location.href = `/auth/check-email?${params.toString()}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("sendFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMagicLink();
  }

  return (
    <div className="mx-auto max-w-md space-y-4 rounded-xl border border-[#30363d] bg-[#161b22] p-6">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-[#8b949e]">{t("subtitle")}</p>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <label className="block space-y-1 text-sm">
          <span className="text-[#8b949e]">{t("email")}</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
            autoComplete="email"
          />
        </label>

        {error ? <p className="text-sm text-[#f85149]">{error}</p> : null}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {submitting ? t("sending") : t("sendLink")}
        </button>
      </form>

      <p className="text-xs text-[#6e7681]">{t("signupHint")}</p>

      <Link href="/" className="inline-block text-sm text-[#58a6ff] hover:underline">
        {t("home")}
      </Link>
    </div>
  );
}
