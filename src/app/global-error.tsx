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
      <body className="min-h-screen bg-[#0d1117] text-[#e6edf3] antialiased">
        <div className="flex min-h-screen items-center justify-center px-4 py-10">
          <div className="mx-auto w-full max-w-md space-y-4 rounded-xl border border-[#f85149]/40 bg-[#f85149]/10 p-6">
            <h1 className="text-xl font-semibold">Something went wrong</h1>
            <p className="text-sm text-[#8b949e]">
              Alliance HQ hit an unexpected error. Try again or return to the home page.
            </p>
            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                onClick={reset}
                className="w-full rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm font-medium text-white"
              >
                Try again
              </button>
              <Link
                href="/"
                className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-4 py-2 text-center text-sm font-medium text-[#e6edf3] hover:bg-[#21262d]"
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
