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
    ? "border-hq-danger/40 bg-hq-danger/10"
    : "border-hq-border bg-hq-surface";
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
    <div className="flex min-h-screen flex-col bg-hq-canvas text-hq-fg">
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div
          className={`mx-auto w-full max-w-md space-y-4 rounded-xl border p-6 ${shellClass(tone)}`}
        >
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="text-sm text-hq-fg-muted">{body}</p>
          {hint ? <p className="text-xs text-hq-fg-subtle">{hint}</p> : null}
          <div className="flex flex-col gap-2 pt-1">
            {onRetry && retryLabel ? (
              <button
                type="button"
                onClick={onRetry}
                className="w-full rounded-lg border border-hq-success bg-hq-success px-4 py-2 text-sm font-medium text-white"
              >
                {retryLabel}
              </button>
            ) : null}
            <Link
              href={homeHref}
              className={
                onRetry
                  ? "w-full rounded-lg border border-hq-border bg-hq-canvas px-4 py-2 text-center text-sm font-medium text-hq-fg hover:bg-hq-surface-muted"
                  : "w-full rounded-lg border border-hq-success bg-hq-success px-4 py-2 text-center text-sm font-medium text-white"
              }
            >
              {homeLabel}
            </Link>
            {secondaryLabel && secondaryHref ? (
              <Link
                href={secondaryHref}
                className="text-center text-sm text-hq-accent hover:underline"
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
