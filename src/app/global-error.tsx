"use client";

import Link from "next/link";
import { useEffect } from "react";

type Props = {
  error: Error & { digest?: string };
  reset: () => void;
};

/**
 * Root fallback when the locale layout fails. Cannot use next-intl here — keep copy in English.
 */
export default function GlobalError({ error, reset }: Props) {
  useEffect(() => {
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen bg-hq-canvas text-hq-fg antialiased">
        <div className="flex min-h-screen items-center justify-center px-4 py-10">
          <div className="mx-auto w-full max-w-md space-y-4 rounded-xl border border-hq-danger/40 bg-hq-danger/10 p-6">
            <h1 className="text-xl font-semibold">Something went wrong</h1>
            <p className="text-sm text-hq-fg-muted">
              Alliance HQ hit an unexpected error. Try again or return to the home page.
            </p>
            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                onClick={reset}
                className="w-full rounded-lg border border-hq-success bg-hq-success px-4 py-2 text-sm font-medium text-white"
              >
                Try again
              </button>
              <Link
                href="/"
                className="w-full rounded-lg border border-hq-border bg-hq-canvas px-4 py-2 text-center text-sm font-medium text-hq-fg hover:bg-hq-surface-muted"
              >
                Go to Alliance HQ
              </Link>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
