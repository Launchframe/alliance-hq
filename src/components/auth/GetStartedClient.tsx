"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Link, useRouter } from "@/i18n/navigation";

export function GetStartedClient() {
  const t = useTranslations("getStarted");
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  async function signOut() {
    setSigningOut(true);
    setSignOutError(null);
    try {
      const res = await fetch("/api/auth/sign-out", { method: "POST" });
      if (!res.ok) {
        setSignOutError(t("signOutFailed"));
        return;
      }
      router.push("/auth");
      router.refresh();
    } catch {
      setSignOutError(t("signOutFailed"));
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 rounded-xl border border-[#30363d] bg-[#161b22] p-6">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">{t("title")}</h1>
            <p className="mt-2 text-sm text-[#8b949e]">{t("body")}</p>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            disabled={signingOut}
            className="shrink-0 text-sm text-[#8b949e] hover:text-[#58a6ff] disabled:opacity-50 underline"
          >
            {signingOut ? t("signingOut") : t("wrongAccount")}
          </button>
        </div>
        {signOutError ? (
          <p className="mt-2 text-sm text-[#f85149]">{signOutError}</p>
        ) : null}
      </div>

      <section className="space-y-2 rounded-lg border border-[#30363d] bg-[#0d1117] p-4">
        <h2 className="text-sm font-semibold">{t("inviteTitle")}</h2>
        <p className="text-sm text-[#8b949e]">{t("inviteBody")}</p>
      </section>

      <section className="space-y-3 rounded-lg border border-[#30363d] bg-[#0d1117] p-4">
        <h2 className="text-sm font-semibold">{t("joinCodeTitle")}</h2>
        <p className="text-sm text-[#8b949e]">{t("joinCodeBody")}</p>
        <Link
          href="/join"
          className="inline-block rounded-lg border border-[#388bfd] bg-[#388bfd]/10 px-4 py-2 text-sm text-[#58a6ff]"
        >
          {t("joinCodeButton")}
        </Link>
      </section>

      <section className="space-y-3 rounded-lg border border-[#30363d] bg-[#0d1117] p-4">
        <h2 className="text-sm font-semibold">{t("connectTitle")}</h2>
        <p className="text-sm text-[#8b949e]">{t("connectBody")}</p>
        <Link
          href="/connect"
          className="inline-block rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white"
        >
          {t("connectButton")}
        </Link>
      </section>
    </div>
  );
}
