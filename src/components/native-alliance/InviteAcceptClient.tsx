"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Link, useRouter } from "@/i18n/navigation";
import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";
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
};

type Props = {
  token: string;
  queryRedirect?: string;
  isAuthenticated: boolean;
  userEmail?: string | null;
};

function authCallbackPath(token: string, queryRedirect?: string): string {
  const invitePath = `/invite/${encodeURIComponent(token)}`;
  if (!queryRedirect) {
    return invitePath;
  }
  return `${invitePath}?next=${encodeURIComponent(queryRedirect)}`;
}

export function InviteAcceptClient({
  token,
  queryRedirect,
  isAuthenticated,
  userEmail,
}: Props) {
  const t = useTranslations("invite");
  const router = useRouter();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [email, setEmail] = useState(userEmail ?? "");
  const [passphrase, setPassphrase] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authHref = `/auth?callbackUrl=${encodeURIComponent(authCallbackPath(token, queryRedirect))}${
    preview?.boundEmail ? `&email=${encodeURIComponent(preview.boundEmail)}` : ""
  }`;

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

  async function acceptInvite() {
    if (!isAuthenticated) {
      router.push(authHref);
      return;
    }

    setSubmitting(true);
    setError(null);
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
          return;
        }
        if (body.code === "auth_required") {
          router.push(authHref);
          return;
        }
        setError(body.error ?? t("acceptFailed"));
        return;
      }
      router.push(body.redirectTo ?? postAcceptHref);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("acceptFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-[#8b949e]">{t("loading")}</p>;
  }

  if (!preview) {
    return (
      <div className="mx-auto max-w-md space-y-3 rounded-xl border border-[#f85149]/40 bg-[#f85149]/10 p-6">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-[#f85149]">{error ?? t("notFound")}</p>
        <Link href="/dashboard" className="text-sm text-[#58a6ff] hover:underline">
          {t("home")}
        </Link>
      </div>
    );
  }

  if (preview.accepted) {
    return (
      <div className="mx-auto max-w-md space-y-3 rounded-xl border border-[#30363d] bg-[#161b22] p-6">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-[#8b949e]">{t("alreadyAccepted")}</p>
        {!isAuthenticated ? (
          <Link
            href={authHref}
            className="inline-block rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white"
          >
            {t("signInToContinue")}
          </Link>
        ) : (
          <button
            type="button"
            disabled={submitting}
            onClick={() => void acceptInvite()}
            className="inline-block rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white disabled:opacity-50"
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
        <p className="text-sm text-[#8b949e]">{t("expired")}</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="mx-auto max-w-md space-y-4 rounded-xl border border-[#30363d] bg-[#161b22] p-6">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-[#8b949e]">
          {t("introSignIn", {
            alliance: preview.allianceName,
            tag: preview.allianceTag ?? "—",
            role: preview.roleName ?? "member",
          })}
        </p>
        <Link
          href={authHref}
          className="inline-block w-full rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-center text-sm text-white"
        >
          {t("signInToAccept")}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-4 rounded-xl border border-[#30363d] bg-[#161b22] p-6">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-[#8b949e]">
        {preview.requiresPassphrase
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

      <form
        className="space-y-4"
        onSubmit={(event) => {
          preventDefaultFormSubmit(event);
          void acceptInvite();
        }}
      >
        {preview.kind === "email" ? (
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
            <span className="block text-xs text-[#6e7681]">{t("emailHint")}</span>
          </label>
        ) : null}

        {preview.requiresPassphrase ? (
          <label className="block space-y-1 text-sm">
            <span className="text-[#8b949e]">{t("passphrase")}</span>
            <input
              type="text"
              required
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 font-mono"
              autoComplete="off"
            />
            <span className="block text-xs text-[#6e7681]">
              {t("passphraseHint")}
            </span>
          </label>
        ) : null}

        <label className="block space-y-1 text-sm">
          <span className="text-[#8b949e]">{t("displayName")}</span>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
            className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
          />
        </label>

        {error ? <p className="text-sm text-[#f85149]">{error}</p> : null}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {submitting ? t("accepting") : t("accept")}
        </button>
      </form>
    </div>
  );
}
