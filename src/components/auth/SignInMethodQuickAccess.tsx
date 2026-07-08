"use client";

import { useCallback, useState } from "react";
import { signIn } from "next-auth/react";
import { signIn as signInWithWebAuthn } from "next-auth/webauthn";
import { useTranslations } from "next-intl";

import {
  AuthMethodPickerRow,
} from "@/components/auth/AuthMethodPicker";
import { Dialog } from "@/components/ui/dialog";
import type { LinkedOAuthProvider } from "@/lib/auth/account-linking.shared";
import {
  resolveSignInMethodLinkedFlags,
  type QuickAccessMethod,
} from "@/lib/auth/sign-in-method-linked.shared";
import type { AuthSsoAvailability } from "@/lib/auth/sso-config.shared";

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
  ssoAvailability: AuthSsoAvailability;
  linkNotice?: LinkedOAuthProvider | null;
  linkError?: string | null;
  callbackPath?: string;
};

export function SignInMethodQuickAccess({
  initialSnapshot,
  ssoAvailability,
  linkNotice,
  linkError,
  callbackPath = "/account",
}: Props) {
  const t = useTranslations("accountSecurity");
  const tAuth = useTranslations("auth");
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [busy, setBusy] = useState(false);
  const [dialogMethod, setDialogMethod] = useState<QuickAccessMethod | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(
    linkNotice
      ? t("linkedProviderSuccess", { provider: methodLabel(t, linkNotice) })
      : null,
  );
  const [error, setError] = useState<string | null>(
    linkError === "OAuthAccountNotLinked"
      ? tAuth("errorOAuthAccountNotLinkedBody")
      : null,
  );

  const linkedState = resolveSignInMethodLinkedFlags(snapshot);
  const availability = {
    google: ssoAvailability.google && snapshot.availableProviders.google,
    discord: ssoAvailability.discord && snapshot.availableProviders.discord,
  };

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
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await signIn(provider, {
        callbackUrl: `${callbackPath}?linked=${provider}`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("linkProviderFailed"));
      setBusy(false);
    }
  }

  async function unlinkProvider(provider: LinkedOAuthProvider) {
    setBusy(true);
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
      setMessage(
        t("unlinkProviderSuccess", { provider: methodLabel(t, provider) }),
      );
      setDialogMethod(null);
      await loadSnapshot();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("unlinkProviderFailed"));
    } finally {
      setBusy(false);
    }
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
      setMessage(t("registerPasskeySuccess"));
      await loadSnapshot();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("registerPasskeyFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function unlinkPasskeys() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/passkeys", { method: "DELETE" });
      if (res.status === 409) {
        setError(t("unlinkLastMethodBlocked"));
        return;
      }
      if (!res.ok) {
        setError(t("passkeyUnlinkFailed"));
        return;
      }
      setMessage(t("passkeyUnlinkSuccess"));
      setDialogMethod(null);
      await loadSnapshot();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("passkeyUnlinkFailed"));
    } finally {
      setBusy(false);
    }
  }

  function handleMethodClick(method: QuickAccessMethod) {
    if (method === "google") {
      if (linkedState.google) {
        setDialogMethod("google");
        return;
      }
      if (availability.google) {
        void linkProvider("google");
      }
      return;
    }
    if (method === "discord") {
      if (linkedState.discord) {
        setDialogMethod("discord");
        return;
      }
      if (availability.discord) {
        void linkProvider("discord");
      }
      return;
    }
    if (method === "passkey") {
      if (linkedState.passkey) {
        setDialogMethod("passkey");
        return;
      }
      void registerPasskey();
      return;
    }
    if (linkedState.email) {
      setDialogMethod("email");
    }
  }

  const dialogTitle =
    dialogMethod != null
      ? t("methodLinkedDialogTitle", { method: methodLabel(t, dialogMethod) })
      : "";

  const dialogBody =
    dialogMethod === "google"
      ? t("methodLinkedDialogBodyGoogle")
      : dialogMethod === "discord"
        ? t("methodLinkedDialogBodyDiscord")
        : dialogMethod === "passkey"
          ? t("methodLinkedDialogBodyPasskey", { count: snapshot.passkeyCount })
          : dialogMethod === "email"
            ? t("methodLinkedDialogBodyEmail", { email: snapshot.email })
            : "";

  const showUnlink =
    dialogMethod === "google" ||
    dialogMethod === "discord" ||
    dialogMethod === "passkey";

  return (
    <>
      <p className="mt-4 text-xs font-medium uppercase tracking-wide text-hq-fg-muted">
        {t("quickAccessLabel")}
      </p>
      <div className="mt-2">
        <AuthMethodPickerRow
          ssoAvailability={{
            google: availability.google,
            discord: availability.discord,
          }}
          linkedState={linkedState}
          disabled={busy}
          ariaLabel={t("quickAccessLabel")}
          labels={{
            google: t("methodGoogle"),
            discord: t("methodDiscord"),
            passkey: t("methodPasskey"),
            email: t("methodEmailMagicLink"),
          }}
          onGoogleClick={() => handleMethodClick("google")}
          onDiscordClick={() => handleMethodClick("discord")}
          onPasskeyClick={() => handleMethodClick("passkey")}
          onEmailClick={() => handleMethodClick("email")}
        />
      </div>

      {message ? <p className="mt-3 text-sm text-hq-green">{message}</p> : null}
      {error ? <p className="mt-3 text-sm text-hq-danger">{error}</p> : null}

      <Dialog
        open={dialogMethod != null}
        onOpenChange={(open) => {
          if (!open) {
            setDialogMethod(null);
          }
        }}
        title={dialogTitle}
      >
        <div className="space-y-4">
          <p className="text-sm text-hq-fg-muted">{dialogBody}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setDialogMethod(null)}
              className="rounded-lg border border-hq-border px-4 py-2 text-sm text-hq-fg disabled:opacity-50"
            >
              {t("methodCloseButton")}
            </button>
            {showUnlink ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (dialogMethod === "google") {
                    void unlinkProvider("google");
                    return;
                  }
                  if (dialogMethod === "discord") {
                    void unlinkProvider("discord");
                    return;
                  }
                  if (dialogMethod === "passkey") {
                    void unlinkPasskeys();
                  }
                }}
                className="rounded-lg border border-hq-danger bg-hq-danger/10 px-4 py-2 text-sm font-medium text-hq-danger disabled:opacity-50"
              >
                {busy ? t("saving") : t("methodUnlinkButton")}
              </button>
            ) : null}
          </div>
        </div>
      </Dialog>
    </>
  );
}

function methodLabel(
  t: ReturnType<typeof useTranslations<"accountSecurity">>,
  method: QuickAccessMethod | LinkedOAuthProvider,
): string {
  switch (method) {
    case "google":
      return t("methodGoogle");
    case "discord":
      return t("methodDiscord");
    case "passkey":
      return t("methodPasskey");
    case "email":
      return t("methodEmailMagicLink");
    default:
      return method;
  }
}
