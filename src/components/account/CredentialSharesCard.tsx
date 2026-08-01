"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

type ShareSummary = {
  id: string;
  status: string;
  allianceId: string;
  ownerHqUserId: string;
  ownerEmail: string;
  ownerDisplayName: string | null;
  delegateEmail: string | null;
  delegateDisplayName: string | null;
  capabilities: string[];
  expiresAt: string | null;
  lastAccessedAt: string | null;
};

type Props = {
  currentHqUserId: string;
};

export function CredentialSharesCard({ currentHqUserId }: Props) {
  const t = useTranslations("credentialShare.account");
  const locale = useLocale();
  const [shares, setShares] = useState<ShareSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/account/credential-shares");
        const data = (await res.json()) as { shares?: ShareSummary[] };
        if (res.ok) {
          setShares(data.shares ?? []);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const activeShares = shares.filter((share) =>
    ["pending", "active"].includes(share.status),
  );

  if (loading) {
    return (
      <section className="rounded-xl border border-hq-border bg-hq-surface p-4">
        <p className="text-sm text-hq-fg-muted">{t("loading")}</p>
      </section>
    );
  }

  if (activeShares.length === 0) {
    return null;
  }

  return (
    <section className="rounded-xl border border-hq-border bg-hq-surface p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-hq-fg">{t("title")}</h2>
          <p className="text-sm text-hq-fg-muted">{t("description")}</p>
        </div>
        <Link href="/account/credential-shares" className="text-sm text-hq-accent hover:underline">
          {t("viewHistory")}
        </Link>
      </div>

      <div className="mt-4 space-y-3">
        {activeShares.map((share) => {
          const isOwner = share.ownerHqUserId === currentHqUserId;
          const counterparty = isOwner
            ? (share.delegateDisplayName ?? share.delegateEmail ?? t("pendingOfficer"))
            : (share.ownerDisplayName ?? share.ownerEmail);
          return (
            <div
              key={share.id}
              className="rounded-lg border border-hq-border bg-hq-canvas px-4 py-3 text-sm"
            >
              <div className="font-medium text-hq-fg">
                {isOwner
                  ? t("grantedTo", { name: counterparty })
                  : t("receivedFrom", { name: counterparty })}
              </div>
              <div className="text-hq-fg-muted">{share.status}</div>
              {share.lastAccessedAt ? (
                <div className="text-hq-fg-muted">
                  {t("lastAccessed", {
                    date: new Date(share.lastAccessedAt).toLocaleString(locale),
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
