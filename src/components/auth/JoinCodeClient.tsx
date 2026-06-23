"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";

type Props = {
  initialCode?: string;
};

export function JoinCodeClient({ initialCode }: Props) {
  const t = useTranslations("join");
  const router = useRouter();
  const [code, setCode] = useState(initialCode ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function redeem() {
    const trimmed = code.trim();
    if (!trimmed) {
      setError(t("codeRequired"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/join-codes/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });
      const body = (await res.json()) as {
        error?: string;
        redirectTo?: string;
      };
      if (!res.ok) {
        setError(body.error ?? t("redeemFailed"));
        return;
      }
      router.push(body.redirectTo ?? "/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("redeemFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-4 rounded-xl border border-[#30363d] bg-[#161b22] p-6">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-[#8b949e]">{t("body")}</p>

      <label className="block space-y-1 text-sm">
        <span className="text-[#8b949e]">{t("code")}</span>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 font-mono uppercase"
          autoComplete="off"
        />
      </label>

      {error ? <p className="text-sm text-[#f85149]">{error}</p> : null}

      <button
        type="button"
        disabled={submitting}
        onClick={() => void redeem()}
        className="w-full rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {submitting ? t("redeeming") : t("redeem")}
      </button>
    </div>
  );
}
