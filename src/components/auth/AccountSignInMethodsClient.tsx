"use client";

import { useCallback, useState } from "react";
import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";

import type { LinkedOAuthProvider } from "@/lib/auth/account-linking.shared";

type LinkedAccountsResponse = {
  email: string;
  hasPassword: boolean;
  passkeyCount: number;
  linkedProviders: LinkedOAuthProvider[];
  availableProviders: {
    google: boolean;
    discord: boolean;
  };
};

type Props = {
  initialSnapshot: LinkedAccountsResponse;
  linkNotice?: LinkedOAuthProvider | null;
};

export function AccountSignInMethodsClient({
  initialSnapshot,
  linkNotice,
}: Props) {
  const t = useTranslations("accountSecurity");
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [busyProvider, setBusyProvider] = useState<LinkedOAuthProvider | null>(
    null,
  );
  const [pendingUnlink, setPendingUnlink] = useState<LinkedOAuthProvider | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(
    linkNotice ? t("linkedProviderSuccess", { provider: providerLabel(t, linkNotice) }) : null,
  );
  const [error, setError] = useState<string | null>(null);

  const loadSnapshot = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/auth/linked-accounts");
      if (!res.ok) {
        setError(t("linkedAccountsLoadFailed"));
        return;
      }
      const body = (await res.json()) as LinkedAccountsResponse;
      setSnapshot(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("linkedAccountsLoadFailed"));
    }
  }, [t]);

  async function linkProvider(provider: LinkedOAuthProvider) {
    setBusyProvider(provider);
    setError(null);
    setMessage(null);
    try {
      await signIn(provider, {
        callbackUrl: `/settings/account?linked=${provider}`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("linkProviderFailed"));
      setBusyProvider(null);
    }
  }

  async function unlinkProvider(provider: LinkedOAuthProvider) {
    setBusyProvider(provider);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/linked-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      if (res.status === 409) {
        setError(t("unlinkLastMethodBlocked"));
        return;
      }
      if (!res.ok) {
        setError(t("unlinkProviderFailed"));
        return;
      }
      setMessage(t("unlinkProviderSuccess", { provider: providerLabel(t, provider) }));
      setPendingUnlink(null);
      await loadSnapshot();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("unlinkProviderFailed"));
    } finally {
      setBusyProvider(null);
    }
  }

  const linked = new Set(snapshot.linkedProviders);

  return (
    <section className="space-y-4 rounded-xl border border-[#30363d] bg-[#161b22] p-5">
      <h2 className="font-medium">{t("signInMethodsTitle")}</h2>
      <p className="text-sm text-[#8b949e]">{t("signInMethodsBody")}</p>

      <ul className="space-y-3 text-sm">
        <li className="flex flex-col gap-2 rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium text-[#e6edf3]">{t("methodEmailMagicLink")}</p>
            <p className="text-[#8b949e]">{snapshot.email}</p>
          </div>
          <span className="text-xs text-[#3fb950]">{t("methodAlwaysAvailable")}</span>
        </li>

        <li className="flex flex-col gap-2 rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium text-[#e6edf3]">{t("methodPassword")}</p>
            <p className="text-[#8b949e]">
              {snapshot.hasPassword ? t("methodConnected") : t("methodNotSet")}
            </p>
          </div>
        </li>

        <li className="flex flex-col gap-2 rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium text-[#e6edf3]">{t("methodPasskey")}</p>
            <p className="text-[#8b949e]">
              {snapshot.passkeyCount > 0
                ? t("passkeySectionBodyCount", { count: snapshot.passkeyCount })
                : t("methodNotSet")}
            </p>
          </div>
        </li>

        {(["google", "discord"] as const).map((provider) => {
          if (!snapshot.availableProviders[provider]) {
            return null;
          }
          const isLinked = linked.has(provider);
          return (
            <li
              key={provider}
              className="flex flex-col gap-2 rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-medium text-[#e6edf3]">
                  {providerLabel(t, provider)}
                </p>
                <p className="text-[#8b949e]">
                  {isLinked ? t("methodConnected") : t("methodNotLinked")}
                </p>
              </div>
              {isLinked ? (
                pendingUnlink === provider ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busyProvider !== null}
                      onClick={() => void unlinkProvider(provider)}
                      className="rounded-lg border border-[#f85149] bg-[#f85149]/10 px-3 py-1.5 text-xs text-[#f85149] disabled:opacity-50"
                    >
                      {busyProvider === provider ? t("saving") : t("confirmUnlink")}
                    </button>
                    <button
                      type="button"
                      disabled={busyProvider !== null}
                      onClick={() => setPendingUnlink(null)}
                      className="rounded-lg border border-[#30363d] px-3 py-1.5 text-xs text-[#e6edf3] disabled:opacity-50"
                    >
                      {t("cancelUnlink")}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={busyProvider !== null}
                    onClick={() => setPendingUnlink(provider)}
                    className="rounded-lg border border-[#30363d] px-3 py-1.5 text-xs text-[#e6edf3] hover:border-[#f85149] disabled:opacity-50"
                  >
                    {t("unlinkProvider")}
                  </button>
                )
              ) : (
                <button
                  type="button"
                  disabled={busyProvider !== null}
                  onClick={() => void linkProvider(provider)}
                  className="rounded-lg border border-[#238636] bg-[#238636] px-3 py-1.5 text-xs text-white disabled:opacity-50"
                >
                  {busyProvider === provider
                    ? t("saving")
                    : t("linkProvider", { provider: providerLabel(t, provider) })}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {message ? <p className="text-sm text-[#3fb950]">{message}</p> : null}
      {error ? <p className="text-sm text-[#f85149]">{error}</p> : null}
    </section>
  );
}

function providerLabel(
  t: ReturnType<typeof useTranslations<"accountSecurity">>,
  provider: LinkedOAuthProvider,
): string {
  return provider === "google" ? t("methodGoogle") : t("methodDiscord");
}
