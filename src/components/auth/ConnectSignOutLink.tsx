"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { useShellNavigation } from "@/components/ashed-shell/useShellNavigation";

export function ConnectSignOutLink() {
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
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void signOut()}
        disabled={signingOut}
        className="text-sm text-hq-fg-muted underline hover:text-hq-accent disabled:opacity-50"
      >
        {signingOut ? t("signingOut") : t("wrongAccount")}
      </button>
      {signOutError ? (
        <p className="max-w-xs text-right text-xs text-hq-danger">{signOutError}</p>
      ) : null}
    </div>
  );
}
