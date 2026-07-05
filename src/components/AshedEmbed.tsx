"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { ashedUrlForPath } from "@/lib/nav/routes";
import { buildVideoUploadHref } from "@/lib/video/score-target-nav";
import { strongText } from "@/components/i18n/richText";

import { Link } from "@/i18n/navigation";

const LOGIN_HINT_DISMISSED_KEY = "ashed-embed-login-hint-dismissed";

function readLoginHintDismissed(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(LOGIN_HINT_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

type Props = {
  path: string;
  labelKey?: string;
  scoreTargetId?: string | null;
};

export function AshedEmbed({ path, labelKey, scoreTargetId = null }: Props) {
  const t = useTranslations("ashedEmbed");
  const tNav = useTranslations("nav");
  const url = ashedUrlForPath(path);
  const title = labelKey ? tNav(labelKey) : path;
  const [hintDismissed, setHintDismissed] = useState(readLoginHintDismissed);

  function dismissHint() {
    setHintDismissed(true);
    try {
      window.localStorage.setItem(LOGIN_HINT_DISMISSED_KEY, "1");
    } catch {
      // ignore storage failures
    }
  }

  return (
    <div className="-mx-4 -mb-4 flex min-h-0 flex-1 flex-col md:mx-0 md:mb-0 md:space-y-4">
      {scoreTargetId ? (
        <div className="border-b border-[#30363d] bg-[#161b22] px-4 py-3 md:hidden">
          <Link
            href={buildVideoUploadHref(scoreTargetId)}
            className="inline-flex w-full items-center justify-center rounded-lg border border-[#238636] bg-[#238636] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#2ea043]"
          >
            {t("uploadVideoScores")}
          </Link>
        </div>
      ) : null}

      <div className="hidden rounded-xl border border-[#30363d] bg-[#161b22] p-5 md:block">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-[#8b949e]">{t("description")}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {scoreTargetId ? (
            <Link
              href={buildVideoUploadHref(scoreTargetId)}
              className="rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white hover:bg-[#2ea043]"
            >
              {t("uploadVideoScores")}
            </Link>
          ) : null}
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className={`rounded-lg border px-4 py-2 text-sm ${
              scoreTargetId
                ? "border-[#30363d] bg-[#21262d] text-[#e6edf3] hover:bg-[#30363d]"
                : "border-[#238636] bg-[#238636] text-white hover:bg-[#2ea043]"
            }`}
          >
            {t("openInAshed")}
          </a>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#0d1117] md:rounded-xl md:border md:border-[#30363d]">
        {!hintDismissed ? (
          <div className="border-b border-[#d29922]/30 bg-[#d29922]/10 px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 text-sm">
                <p className="font-medium text-[#e3b341]">
                  {t("loginHint.title")}
                </p>
                <p className="mt-1 text-[#8b949e]">
                  {t.rich("loginHint.body", { strong: strongText })}
                </p>
              </div>
              <button
                type="button"
                onClick={dismissHint}
                className="shrink-0 rounded-lg border border-[#30363d] bg-[#21262d] px-3 py-1.5 text-xs text-[#e6edf3] hover:bg-[#30363d]"
              >
                {t("loginHint.dismiss")}
              </button>
            </div>
          </div>
        ) : null}
        <iframe
          src={url}
          title={t("iframeTitle", { path: title })}
          className="min-h-0 w-full flex-1 md:h-[min(70vh,720px)] md:flex-none"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
        />
        {!hintDismissed ? (
          <p className="hidden border-t border-[#30363d] px-4 py-2 text-xs text-[#8b949e] md:block">
            {t("iframeHint")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
