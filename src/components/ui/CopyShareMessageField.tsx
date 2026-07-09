"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type Props = {
  message: string;
  label?: string;
  className?: string;
};

export function CopyShareMessageField({ message, label, className }: Props) {
  const t = useTranslations("team.invites.wizard");
  const tCommon = useTranslations("common");
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  async function handleCopy() {
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      setCopyFailed(true);
    }
  }

  return (
    <div className={cn("space-y-1", className)}>
      {label ? <p className="text-xs text-[#8b949e]">{label}</p> : null}
      <div className="flex min-w-0 items-start gap-2 rounded-lg border border-[#30363d] bg-[#0d1117] p-2">
        <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm text-[#e6edf3]">
          {message}
        </p>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#388bfd] bg-[#388bfd]/10 px-2.5 py-1.5 text-xs text-[#58a6ff] transition-colors hover:bg-[#388bfd]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#58a6ff]"
          aria-label={tCommon("copyToClipboard")}
        >
          {copied ? (
            <>
              <Check className="size-3.5" aria-hidden />
              {t("copied")}
            </>
          ) : (
            <>
              <Copy className="size-3.5" aria-hidden />
              {t("copyShareMessage")}
            </>
          )}
        </button>
      </div>
      {copyFailed ? (
        <p className="text-xs text-[#f85149]" role="alert">
          {tCommon("copyFailed")}
        </p>
      ) : null}
    </div>
  );
}
