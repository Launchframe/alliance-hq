"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { useShellNavigation } from "@/components/ashed-shell/useShellNavigation";

export function GetStartedClient() {
  const t = useTranslations("getStarted");
  const { pushAndRefresh } = useShellNavigation();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  async function signOut() {
    setSigningOut(true);
    setSignOutError(null);
    try {
      const res = await fetch("/api/auth/sign-out", { method: "POST" });
      if (!res.ok) {
        setSignOutError(t("signOutFailed"));
        setSigningOut(false);
        return;
      }
      pushAndRefresh("/auth", "signOut");
    } catch {
      setSignOutError(t("signOutFailed"));
      setSigningOut(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 rounded-xl border border-hq-border bg-hq-surface p-6">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">{t("title")}</h1>
            <p className="mt-2 text-sm text-hq-fg-muted">{t("body")}</p>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            disabled={signingOut}
            className="shrink-0 text-sm text-hq-fg-muted hover:text-hq-accent disabled:opacity-50 underline"
          >
            {signingOut ? t("signingOut") : t("wrongAccount")}
          </button>
        </div>
        {signOutError ? (
          <p className="mt-2 text-sm text-hq-danger">{signOutError}</p>
        ) : null}
      </div>

      <section className="space-y-2 rounded-lg border border-hq-border bg-hq-canvas p-4">
        <h2 className="text-sm font-semibold">{t("inviteTitle")}</h2>
        <p className="text-sm text-hq-fg-muted">{t("inviteBody")}</p>
      </section>

      <section className="space-y-3 rounded-lg border border-hq-border bg-hq-canvas p-4">
        <h2 className="text-sm font-semibold">{t("joinCodeTitle")}</h2>
        <p className="text-sm text-hq-fg-muted">{t("joinCodeBody")}</p>
        <Link
          href="/join"
          className="inline-block rounded-lg border border-[#388bfd] bg-[#388bfd]/10 px-4 py-2 text-sm text-hq-accent"
        >
          {t("joinCodeButton")}
        </Link>
      </section>

      <section className="space-y-3 rounded-lg border border-hq-border bg-hq-canvas p-4">
        <h2 className="text-sm font-semibold">{t("connectTitle")}</h2>
        <p className="text-sm text-hq-fg-muted">{t("connectBody")}</p>
        <Link
          href="/connect"
          className="inline-block rounded-lg border border-hq-success bg-hq-success px-4 py-2 text-sm text-white"
        >
          {t("connectButton")}
        </Link>
      </section>
    </div>
  );
}
