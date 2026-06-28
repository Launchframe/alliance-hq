"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";

export function AccountDiscordLinkSection({
  linked,
  discordAvailable,
  linkNotice,
  linkError,
}: {
  linked: boolean;
  discordAvailable: boolean;
  linkNotice?: "linked" | "unlinked" | null;
  linkError?: string | null;
}) {
  const t = useTranslations("account");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [messageState, setMessageState] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);

  const successMessage =
    linkNotice === "linked"
      ? t("discordLinkedNotice")
      : linkNotice === "unlinked"
        ? t("discordUnlinkedNotice")
        : null;

  const errorMessage =
    linkError === "no_oauth"
      ? t("discordLinkErrorNoOAuth")
      : linkError === "last_method"
        ? t("discordUnlinkLastMethod")
        : linkError
          ? t("discordLinkErrorGeneric")
          : null;

  async function linkDiscord() {
    setBusy(true);
    setMessageState(null);
    await signIn("discord", {
      callbackUrl: "/discord/hq-link/complete?return=%2Faccount",
    });
  }

  async function unlinkDiscord() {
    setBusy(true);
    setMessageState(null);
    try {
      const res = await fetch("/api/discord/hq-link/unlink", { method: "POST" });
      const body = (await res.json()) as { error?: string; code?: string };
      if (!res.ok) {
        setMessageState({
          text:
            body.code === "last_sign_in_method"
              ? t("discordUnlinkLastMethod")
              : (body.error ?? t("discordUnlinkFailed")),
          type: "error",
        });
        return;
      }
      setMessageState({ text: t("discordUnlinkedNotice"), type: "success" });
      router.refresh();
    } catch {
      setMessageState({ text: t("discordUnlinkFailed"), type: "error" });
    } finally {
      setBusy(false);
    }
  }

  // Keep the section mounted while a transitional message is showing (e.g.
  // after a successful unlink the server re-renders with linked=false but we
  // still need to display the "Discord unlinked" confirmation briefly).
  if (!discordAvailable && !linked && !messageState) {
    return null;
  }

  return (
    <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
      <h2 className="font-medium">{t("discordSection")}</h2>
      <p className="mt-2 text-sm text-[#8b949e]">
        {linked ? t("discordLinkedBody") : t("discordUnlinkedBody")}
      </p>
      {successMessage ? (
        <p className="mt-3 text-sm text-[#3fb950]">{successMessage}</p>
      ) : null}
      {errorMessage ? (
        <p className="mt-3 text-sm text-[#f85149]">{errorMessage}</p>
      ) : null}
      {messageState ? (
        <p
          className={`mt-3 text-sm ${
            messageState.type === "success" ? "text-[#3fb950]" : "text-[#f85149]"
          }`}
        >
          {messageState.text}
        </p>
      ) : null}
      {linked ? (
        <button
          type="button"
          onClick={() => void unlinkDiscord()}
          disabled={busy}
          className="mt-4 rounded-lg border border-[#f85149] px-4 py-2 text-sm text-[#f85149] hover:bg-[#f8514920] disabled:opacity-50"
        >
          {busy ? t("discordUnlinking") : t("discordUnlinkButton")}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void linkDiscord()}
          disabled={busy || !discordAvailable}
          className="mt-4 rounded-lg border border-[#5865F2] bg-[#5865F2] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? t("discordLinking") : t("discordLinkButton")}
        </button>
      )}
    </section>
  );
}
