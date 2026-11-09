"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";

type Props = {
  tag: string;
  layout?: "banner" | "card";
};

export function AllianceCredentialMissingNotice({
  tag,
  layout = "banner",
}: Props) {
  const t = useTranslations("tokenExpiry");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installed, setInstalled] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/team/alliance-ashed-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(
          typeof data.error === "string" && data.error.trim()
            ? data.error
            : t("allianceMissingFailed"),
        );
        return;
      }
      setInstalled(true);
      router.refresh();
    } catch {
      setError(t("allianceMissingFailed"));
    } finally {
      setPending(false);
    }
  }

  const shell =
    layout === "banner"
      ? "border-b border-hq-warning/40 bg-hq-warning/10 px-6 py-3 text-sm text-hq-fg"
      : "space-y-3 rounded-xl border border-hq-warning/40 bg-hq-warning/10 p-4 text-sm text-hq-fg";

  return (
    <div className={shell} data-testid="alliance-credential-missing">
      <p>{t("allianceMissingBanner", { tag })}</p>
      {installed ? (
        <p className="mt-2 text-hq-green" role="status">
          {t("allianceMissingInstalled", { tag })}
        </p>
      ) : (
        <form onSubmit={(event) => void onSubmit(event)} className="mt-2">
          <button
            type="submit"
            disabled={pending}
            data-testid="install-alliance-ashed-credentials"
            className="rounded-lg bg-hq-accent px-3 py-1.5 text-sm font-medium text-hq-accent-fg disabled:opacity-50"
          >
            {t("allianceMissingAction")}
          </button>
          {error ? (
            <p className="mt-2 text-hq-danger" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      )}
    </div>
  );
}
