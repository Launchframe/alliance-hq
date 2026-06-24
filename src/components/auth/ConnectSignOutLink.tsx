"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";

export function ConnectSignOutLink() {
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
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void signOut()}
        disabled={signingOut}
        className="text-sm text-[#8b949e] underline hover:text-[#58a6ff] disabled:opacity-50"
      >
        {signingOut ? t("signingOut") : t("wrongAccount")}
      </button>
      {signOutError ? (
        <p className="max-w-xs text-right text-xs text-[#f85149]">{signOutError}</p>
      ) : null}
    </div>
  );
}
