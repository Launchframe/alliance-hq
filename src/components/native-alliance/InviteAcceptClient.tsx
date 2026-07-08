"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { signIn } from "next-auth/react";

import { DiscordIcon } from "@/components/auth/AuthMethodPicker";
import { Link } from "@/i18n/navigation";
import { useShellNavigation } from "@/components/ashed-shell/useShellNavigation";
import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";
import type { AuthSsoAvailability } from "@/lib/auth/sso-config.shared";
import { resolveInviteRedirect } from "@/lib/navigation/safe-redirect.shared";

type InvitePreview = {
  allianceName: string;
  allianceTag: string | null;
  roleName: string | null;
  expiresAt: string;
  expired: boolean;
  accepted: boolean;
  redirectPath: string | null;
  kind: "email" | "protected_link" | "discord_officer";
  requiresPassphrase: boolean;
  requiresDiscordLogin: boolean;
  boundEmail: string | null;
  targetCommanderName: string | null;
  boundDiscordUserIdHint: string | null;
};

type Props = {
  token: string;
  queryRedirect?: string;
  isAuthenticated: boolean;
  userEmail?: string | null;
  ssoAvailability: AuthSsoAvailability;
};

function authCallbackPath(token: string, queryRedirect?: string): string {
  const invitePath = `/invite/${encodeURIComponent(token)}`;
  if (!queryRedirect) {
    return invitePath;
  }
  return `${invitePath}?next=${encodeURIComponent(queryRedirect)}`;
}

function buildAuthHref(
  token: string,
  queryRedirect: string | undefined,
  boundEmail: string | null | undefined,
): string {
  const params = new URLSearchParams({
    callbackUrl: authCallbackPath(token, queryRedirect),
    from: "invite",
  });
  if (boundEmail?.trim()) {
    params.set("email", boundEmail.trim());
  }
  return `/auth?${params.toString()}`;
}

export function InviteAcceptClient({
  token,
  queryRedirect,
  isAuthenticated,
  userEmail,
  ssoAvailability,
}: Props) {
  const t = useTranslations("invite");
  const { push, beginSessionChange, beginNavigation } = useShellNavigation();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [email, setEmail] = useState(userEmail ?? "");
  const [passphrase, setPassphrase] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAccountHint, setShowAccountHint] = useState(false);

  const authHref = buildAuthHref(token, queryRedirect, preview?.boundEmail);

  const postAcceptHref = useMemo(
    () =>
      resolveInviteRedirect({
        queryNext: queryRedirect,
        storedPath: preview?.redirectPath,
      }),
    [preview?.redirectPath, queryRedirect],
  );

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/invite/${encodeURIComponent(token)}`);
        const body = (await res.json()) as {
          invite?: InvitePreview;
          error?: string;
        };
        if (!res.ok || !body.invite) {
          setError(body.error ?? t("notFound"));
          return;
        }
        setPreview(body.invite);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("loadFailed"));
      } finally {
        setLoading(false);
      }
    })();
  }, [t, token]);

  async function signInWithDiscord() {
    setSubmitting(true);
    setError(null);
    try {
      await signIn("discord", {
        callbackUrl: authCallbackPath(token, queryRedirect),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("signInFailed"));
      setSubmitting(false);
    }
  }

  async function acceptInvite() {
    if (!isAuthenticated) {
      if (preview?.requiresDiscordLogin) {
        await signInWithDiscord();
      } else {
        beginNavigation();
        push(authHref);
      }
      return;
    }

    setSubmitting(true);
    setError(null);
    setShowAccountHint(false);
    let navigated = false;
    try {
      const res = await fetch(
        `/api/invite/${encodeURIComponent(token)}/accept`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: preview?.kind === "email" ? email.trim() : undefined,
            passphrase: preview?.requiresPassphrase
              ? passphrase.trim()
              : undefined,
            displayName: displayName.trim() || undefined,
            next: queryRedirect,
          }),
        },
      );
      const body = (await res.json()) as {
        error?: string;
        code?: string;
        redirectTo?: string;
      };
      if (!res.ok) {
        if (body.code === "email_mismatch") {
          setError(t("emailMismatch"));
          setShowAccountHint(true);
          return;
        }
        if (body.code === "invite_belongs_to_other_account") {
          setError(t("belongsToOtherAccount"));
          setShowAccountHint(true);
          return;
        }
        if (body.code === "auth_required") {
          if (preview?.requiresDiscordLogin) {
            await signInWithDiscord();
          } else {
            beginNavigation();
            push(authHref);
            navigated = true;
          }
          return;
        }
        if (body.code === "discord_login_required") {
          setError(t("discordLoginRequired"));
          return;
        }
        if (body.code === "discord_user_mismatch") {
          setError(t("discordUserMismatch"));
          return;
        }
        setError(body.error ?? t("acceptFailed"));
        return;
      }
      beginSessionChange("invite");
      push(body.redirectTo ?? postAcceptHref);
      navigated = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("acceptFailed"));
    } finally {
      if (!navigated) {
        setSubmitting(false);
      }
    }
  }

  function renderSignInGate(introKey: "introSignInDiscord" | "introSignIn") {
    if (!preview) {
      return null;
    }

    return (
      <div className="mx-auto max-w-md space-y-4 rounded-xl border border-hq-border bg-hq-surface p-6">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-hq-fg-muted">
          {preview.requiresDiscordLogin
            ? t("introDiscordSignIn", {
                alliance: preview.allianceName,
                tag: preview.allianceTag ?? "—",
                role: preview.roleName ?? "member",
                hint: preview.boundDiscordUserIdHint ?? "—",
              })
            : t(introKey, {
                alliance: preview.allianceName,
                tag: preview.allianceTag ?? "—",
                role: preview.roleName ?? "member",
              })}
        </p>
        {preview.targetCommanderName ? (
          <p className="text-sm text-hq-fg-muted">
            {t("introSignInClaim", { name: preview.targetCommanderName })}
          </p>
        ) : null}
        {ssoAvailability.discord ? (
          <>
            <p
              className="rounded-lg border border-hq-discord/35 bg-hq-discord/10 px-3 py-2.5 text-sm leading-snug text-hq-fg"
              role="note"
            >
              {t("discordPrimaryHint")}
            </p>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void signInWithDiscord()}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-hq-discord bg-hq-discord px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              <DiscordIcon />
              {submitting ? t("signingIn") : t("signInWithDiscord")}
            </button>
          </>
        ) : null}
        {error ? <p className="text-sm text-hq-danger">{error}</p> : null}
        <Link
          href={authHref}
          className={`inline-block w-full rounded-lg border px-4 py-2 text-center text-sm ${
            ssoAvailability.discord
              ? "border-hq-border text-hq-fg hover:border-[#484f58]"
              : "border-hq-success bg-hq-success text-white"
          }`}
        >
          {ssoAvailability.discord ? t("otherSignInOptions") : t("signInToAccept")}
        </Link>
      </div>
    );
  }

  if (loading) {
    return <p className="text-sm text-hq-fg-muted">{t("loading")}</p>;
  }

  if (!preview) {
    return (
      <div className="mx-auto max-w-md space-y-3 rounded-xl border border-hq-danger/40 bg-hq-danger/10 p-6">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-hq-danger">{error ?? t("notFound")}</p>
        <Link href="/dashboard" className="text-sm text-hq-accent hover:underline">
          {t("home")}
        </Link>
      </div>
    );
  }

  if (preview.accepted) {
    return (
      <div className="mx-auto max-w-md space-y-3 rounded-xl border border-hq-border bg-hq-surface p-6">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-hq-fg-muted">{t("alreadyAccepted")}</p>
        {!isAuthenticated ? (
          preview.requiresDiscordLogin ? (
            <button
              type="button"
              disabled={submitting}
              onClick={() => void signInWithDiscord()}
              className="inline-block rounded-lg border border-hq-success bg-hq-success px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {t("signInWithDiscord")}
            </button>
          ) : (
            renderSignInGate("introSignIn")
          )
        ) : (
          <button
            type="button"
            disabled={submitting}
            onClick={() => void acceptInvite()}
            className="inline-block rounded-lg border border-hq-success bg-hq-success px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {submitting ? t("accepting") : t("goToApp")}
          </button>
        )}
      </div>
    );
  }

  if (preview.expired) {
    return (
      <div className="mx-auto max-w-md space-y-3 rounded-xl border border-[#d29922]/40 bg-[#d29922]/10 p-6">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-hq-fg-muted">{t("expired")}</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return renderSignInGate("introSignInDiscord");
  }

  return (
    <div className="mx-auto max-w-md space-y-4 rounded-xl border border-hq-border bg-hq-surface p-6">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-hq-fg-muted">
        {preview.requiresDiscordLogin
          ? t("introDiscordPassphrase", {
              alliance: preview.allianceName,
              tag: preview.allianceTag ?? "—",
              role: preview.roleName ?? "member",
              hint: preview.boundDiscordUserIdHint ?? "—",
            })
          : preview.requiresPassphrase
            ? t("introPassphrase", {
                alliance: preview.allianceName,
                tag: preview.allianceTag ?? "—",
                role: preview.roleName ?? "member",
              })
            : t("intro", {
                alliance: preview.allianceName,
                tag: preview.allianceTag ?? "—",
                role: preview.roleName ?? "member",
              })}
      </p>
      {preview.targetCommanderName ? (
        <p className="text-sm text-hq-fg-muted">
          {t("introAcceptClaim", { name: preview.targetCommanderName })}
        </p>
      ) : null}

      <form
        className="space-y-4"
        onSubmit={(event) => {
          preventDefaultFormSubmit(event);
          void acceptInvite();
        }}
      >
        {preview.kind === "email" ? (
          <label className="block space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("email")}</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2"
              autoComplete="email"
            />
            <span className="block text-xs text-hq-fg-subtle">{t("emailHint")}</span>
          </label>
        ) : null}

        {preview.requiresPassphrase ? (
          <label className="block space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("passphrase")}</span>
            <input
              type="text"
              required
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 font-mono"
              autoComplete="off"
            />
            <span className="block text-xs text-hq-fg-subtle">
              {t("passphraseHint")}
            </span>
          </label>
        ) : null}

        <label className="block space-y-1 text-sm">
          <span className="text-hq-fg-muted">{t("displayName")}</span>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
            className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2"
          />
        </label>

        {error ? <p className="text-sm text-hq-danger">{error}</p> : null}
        {showAccountHint ? (
          <p className="text-sm text-hq-fg-muted">
            {error === t("belongsToOtherAccount")
              ? t("belongsToOtherAccountHint")
              : (
                <>
                  {t("wrongAccountHint")}{" "}
                  <Link href="/settings/account" className="text-hq-accent hover:underline">
                    {t("wrongAccountHintLink")}
                  </Link>
                </>
              )}
          </p>
        ) : null}

        {preview.requiresDiscordLogin ? (
          <button
            type="button"
            disabled={submitting}
            onClick={() => void signInWithDiscord()}
            className="w-full rounded-lg border border-hq-border bg-hq-canvas px-4 py-2 text-sm text-hq-fg"
          >
            {t("switchDiscordAccount")}
          </button>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg border border-hq-success bg-hq-success px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {submitting ? t("accepting") : t("accept")}
        </button>
      </form>
    </div>
  );
}
