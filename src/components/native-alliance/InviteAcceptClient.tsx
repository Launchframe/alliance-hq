"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Link, useRouter } from "@/i18n/navigation";

type InvitePreview = {
  allianceName: string;
  allianceTag: string | null;
  roleName: string | null;
  expiresAt: string;
  expired: boolean;
  accepted: boolean;
};

function isValidEmail(value: string): boolean {
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export function InviteAcceptClient({ token }: { token: string }) {
  const t = useTranslations("invite");
  const router = useRouter();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailValid = isValidEmail(email);

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
    if (!emailValid) {
      setError(t("emailRequired"));
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
            email: email.trim(),
            displayName: displayName.trim() || undefined,
          }),
        },
      );
      const body = (await res.json()) as {
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        if (body.code === "email_mismatch") {
          setError(t("emailMismatch"));
          return;
        }
        setError(body.error ?? t("acceptFailed"));
        return;
      }
      router.push("/connect?welcome=1");
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
        <Link href="/" className="text-sm text-[#58a6ff] hover:underline">
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
        <Link
          href="/connect?welcome=1"
          className="inline-block rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white"
        >
          {t("goToApp")}
        </Link>
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

  return (
    <div className="mx-auto max-w-md space-y-4 rounded-xl border border-[#30363d] bg-[#161b22] p-6">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-[#8b949e]">
        {t("intro", {
          alliance: preview.allianceName,
          tag: preview.allianceTag ?? "—",
          role: preview.roleName ?? "member",
        })}
      </p>

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

      <label className="block space-y-1 text-sm">
        <span className="text-[#8b949e]">{t("displayName")}</span>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
        />
      </label>

      {error ? <p className="text-sm text-[#f85149]">{error}</p> : null}

      <button
        type="button"
        disabled={submitting || !emailValid}
        onClick={() => void acceptInvite()}
        className="w-full rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {submitting ? t("accepting") : t("accept")}
      </button>
    </div>
  );
}
