"use client";

import { useState } from "react";
import { signIn as signInWithWebAuthn } from "next-auth/webauthn";
import { useTranslations } from "next-intl";

type Props = {
  passkeyCount: number;
};

type LinkedAccountsResponse = {
  passkeyCount: number;
};

export function AccountPasskeysCard({ passkeyCount: initialPasskeyCount }: Props) {
  const t = useTranslations("accountSecurity");
  const [passkeyCount, setPasskeyCount] = useState(initialPasskeyCount);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refreshPasskeyCount(): Promise<void> {
    const res = await fetch("/api/auth/linked-accounts");
    if (!res.ok) {
      throw new Error("linked-accounts fetch failed");
    }
    const body = (await res.json()) as LinkedAccountsResponse;
    setPasskeyCount(body.passkeyCount);
  }

  async function registerPasskey() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await signInWithWebAuthn("passkey", {
        action: "register",
        redirect: false,
      });
      if (result?.error) {
        setError(t("registerPasskeyFailed"));
        return;
      }
      try {
        await refreshPasskeyCount();
      } catch {
        window.location.reload();
        return;
      }
      setMessage(t("registerPasskeySuccess"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("registerPasskeyFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-[#30363d] bg-[#161b22] p-5">
      <h2 className="font-medium">{t("passkeySectionTitle")}</h2>
      <p className="text-sm text-[#8b949e]">
        {passkeyCount > 0
          ? t("passkeySectionBodyCount", { count: passkeyCount })
          : t("passkeySectionBodyNone")}
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void registerPasskey()}
        className="rounded-lg border border-[#30363d] bg-[#0d1117] px-4 py-2 text-sm text-[#e6edf3] hover:border-[#58a6ff] disabled:opacity-50"
      >
        {busy ? t("saving") : t("addPasskey")}
      </button>
      {message ? <p className="text-sm text-[#3fb950]">{message}</p> : null}
      {error ? <p className="text-sm text-[#f85149]">{error}</p> : null}
    </section>
  );
}
