"use client";

import { Link } from "@/i18n/navigation";

type Props = {
  title: string;
  body: string;
  hint?: string;
  tone?: "notFound" | "error";
  retryLabel?: string;
  onRetry?: () => void;
  homeLabel: string;
  homeHref?: string;
  secondaryLabel?: string;
  secondaryHref?: string;
};

function shellClass(tone: "notFound" | "error"): string {
  return tone === "error"
    ? "border-[#f85149]/40 bg-[#f85149]/10"
    : "border-[#30363d] bg-[#161b22]";
}

export function HttpErrorPage({
  title,
  body,
  hint,
  tone = "notFound",
  retryLabel,
  onRetry,
  homeLabel,
  homeHref = "/",
  secondaryLabel,
  secondaryHref,
}: Props) {
  return (
    <div className="flex min-h-screen flex-col bg-[#0d1117] text-[#e6edf3]">
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div
          className={`mx-auto w-full max-w-md space-y-4 rounded-xl border p-6 ${shellClass(tone)}`}
        >
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="text-sm text-[#8b949e]">{body}</p>
          {hint ? <p className="text-xs text-[#6e7681]">{hint}</p> : null}
          <div className="flex flex-col gap-2 pt-1">
            {onRetry && retryLabel ? (
              <button
                type="button"
                onClick={onRetry}
                className="w-full rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm font-medium text-white"
              >
                {retryLabel}
              </button>
            ) : null}
            <Link
              href={homeHref}
              className={
                onRetry
                  ? "w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-4 py-2 text-center text-sm font-medium text-[#e6edf3] hover:bg-[#21262d]"
                  : "w-full rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-center text-sm font-medium text-white"
              }
            >
              {homeLabel}
            </Link>
            {secondaryLabel && secondaryHref ? (
              <Link
                href={secondaryHref}
                className="text-center text-sm text-[#58a6ff] hover:underline"
              >
                {secondaryLabel}
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
