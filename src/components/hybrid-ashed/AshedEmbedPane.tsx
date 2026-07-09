"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { ashedUrlForPath } from "@/lib/nav/routes";
import { strongText } from "@/components/i18n/richText";

const LOGIN_HINT_DISMISSED_KEY = "ashed-embed-login-hint-dismissed";

function readLoginHintDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(LOGIN_HINT_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

type Props = {
  path: string;
  title: string;
};

export function AshedEmbedPane({ path, title }: Props) {
  const t = useTranslations("ashedEmbed");
  const tShell = useTranslations("shellActivity");
  const url = ashedUrlForPath(path);
  const [hintDismissed, setHintDismissed] = useState(readLoginHintDismissed);
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const iframeLoading = loadedPath !== path;

  function dismissHint() {
    setHintDismissed(true);
    try {
      window.localStorage.setItem(LOGIN_HINT_DISMISSED_KEY, "1");
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-hq-canvas">
      {!hintDismissed ? (
        <div className="border-b border-[#d29922]/30 bg-[#d29922]/10 px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 text-sm">
              <p className="font-medium text-[#e3b341]">{t("loginHint.title")}</p>
              <p className="mt-1 text-hq-fg-muted">
                {t.rich("loginHint.body", { strong: strongText })}
              </p>
            </div>
            <button
              type="button"
              onClick={dismissHint}
              className="shrink-0 rounded-lg border border-hq-border bg-hq-surface-muted px-3 py-1.5 text-xs text-hq-fg hover:bg-hq-border"
            >
              {t("loginHint.dismiss")}
            </button>
          </div>
        </div>
      ) : null}
      {iframeLoading ? (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-hq-canvas/80"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2 text-sm text-hq-fg-muted">
            <Loader2 className="h-5 w-5 animate-spin text-hq-accent" aria-hidden />
            {tShell("loadingPage")}
          </div>
        </div>
      ) : null}
      <iframe
        key={path}
        src={url}
        title={t("iframeTitle", { path: title })}
        className="min-h-0 w-full flex-1"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
        onLoad={() => setLoadedPath(path)}
      />
    </div>
  );
}
