"use client";

import Link from "next/link";

import type { AshedConnectionMeta } from "@/lib/jwt/connection-meta";
import {
  ASHED_LOGOUT_WARNING,
  tokenExpiryReminderMessage,
} from "@/lib/jwt/messages";

type Props = {
  ashed: AshedConnectionMeta;
};

export function TokenExpiryBanner({ ashed }: Props) {
  if (!ashed.showExpiryReminder || !ashed.tokenExpiresAtFormatted) {
    return null;
  }

  return (
    <div
      className={`border-b px-6 py-3 text-sm ${
        ashed.isTokenExpired
          ? "border-[#f85149]/40 bg-[#f8514915] text-[#f85149]"
          : "border-[#d29922]/40 bg-[#d2992215] text-[#e6edf3]"
      }`}
    >
      <p>
        {ashed.isTokenExpired ? (
          <>
            Your Ashed token expired on{" "}
            <strong>{ashed.tokenExpiresAtFormatted}</strong>.{" "}
            <Link href="/connect" className="text-[#58a6ff] hover:underline">
              Reconnect with a fresh cURL command
            </Link>
            .
          </>
        ) : (
          <>
            {tokenExpiryReminderMessage(ashed.tokenExpiresAtFormatted)}{" "}
            <Link href="/connect" className="text-[#58a6ff] hover:underline">
              Update connection
            </Link>
            .
          </>
        )}
      </p>
    </div>
  );
}

export function TokenExpiryNotice({
  formattedDate,
  reminderDays,
  className,
}: {
  formattedDate: string;
  reminderDays: number;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-[#30363d] bg-[#0d1117] px-4 py-3 text-sm ${className ?? ""}`}
    >
      <p>
        Your Ashed token is set to expire on{" "}
        <strong className="text-[#e6edf3]">{formattedDate}</strong>. We&apos;ll
        remind you{" "}
        <strong className="text-[#e6edf3]">{reminderDays} days</strong>{" "}before
        it&apos;s time to get a fresh token.
      </p>
      <p className="mt-2 text-[#8b949e]">
        <strong className="text-[#d29922]">Note:</strong> {ASHED_LOGOUT_WARNING}
      </p>
    </div>
  );
}
