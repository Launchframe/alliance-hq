"use client";

import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { CopyToClipboardField } from "@/components/ui/CopyToClipboardField";
import type { CredentialShareCapability } from "@/lib/ashed/credential-share-capabilities.shared";
import { CREDENTIAL_SHARE_CAPABILITIES } from "@/lib/ashed/credential-share-capabilities.shared";
import { preventDefaultFormSubmit } from "@/lib/client/form-enter-submit.shared";

type OfficerCandidate = {
  hqUserId: string;
  email: string;
  displayName: string | null;
  roleName: string;
};

type ShareSummary = {
  id: string;
  status: string;
  ownerHqUserId: string;
  ownerEmail: string;
  ownerDisplayName: string | null;
  delegateEmail: string | null;
  delegateDisplayName: string | null;
  invitedHqUserId: string;
  capabilities: CredentialShareCapability[];
  expiresAt: string | null;
  lastAccessedAt: string | null;
};

type ActivityEntry = {
  id: string;
  action: string;
  createdAt: string;
};

type Props = {
  canManage: boolean;
  currentHqUserId: string | null;
};

const TTL_PRESETS = [
  { hours: 24, labelKey: "ttl24h" as const },
  { hours: 72, labelKey: "ttl72h" as const },
  { hours: 168, labelKey: "ttl7d" as const },
];

export function CredentialSharePanel({ canManage, currentHqUserId }: Props) {
  const t = useTranslations("credentialShare.team");
  const locale = useLocale();
  const [loading, setLoading] = useState(true);
  const [shares, setShares] = useState<ShareSummary[]>([]);
  const [recentActivity, setRecentActivity] = useState<ActivityEntry[]>([]);
  const [officers, setOfficers] = useState<OfficerCandidate[]>([]);
  const [invitedHqUserId, setInvitedHqUserId] = useState("");
  const [capabilities, setCapabilities] = useState<CredentialShareCapability[]>([
    "roster:sync",
  ]);
  const [ttlHours, setTtlHours] = useState(72);
  const [ownerAcknowledged, setOwnerAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pairingLinkUrl, setPairingLinkUrl] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/settings/team/credential-shares?locale=${encodeURIComponent(locale)}`,
      );
      const data = (await res.json()) as {
        shares?: ShareSummary[];
        recentActivity?: ActivityEntry[];
        officerCandidates?: OfficerCandidate[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? t("loadFailed"));
      }
      setShares(data.shares ?? []);
      setRecentActivity(data.recentActivity ?? []);
      setOfficers(data.officerCandidates ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [locale, t]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/settings/team/credential-shares?locale=${encodeURIComponent(locale)}`,
        );
        const data = (await res.json()) as {
          shares?: ShareSummary[];
          recentActivity?: ActivityEntry[];
          officerCandidates?: OfficerCandidate[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(data.error ?? t("loadFailed"));
        }
        setShares(data.shares ?? []);
        setRecentActivity(data.recentActivity ?? []);
        setOfficers(data.officerCandidates ?? []);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : t("loadFailed"),
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locale, t]);

  const toggleCapability = (capability: CredentialShareCapability) => {
    setCapabilities((current) =>
      current.includes(capability)
        ? current.filter((value) => value !== capability)
        : [...current, capability],
    );
  };

  const createShare = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/team/credential-shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invitedHqUserId,
          capabilities,
          ttlHours,
          locale,
        }),
      });
      const data = (await res.json()) as {
        share?: ShareSummary;
        pairing?: { linkUrl: string };
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? t("createFailed"));
      }
      setPairingLinkUrl(data.pairing?.linkUrl ?? null);
      setShowQr(true);
      await load();
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : t("createFailed"),
      );
    } finally {
      setCreating(false);
    }
  };

  const revokeShare = async (shareId: string) => {
    setError(null);
    const res = await fetch(`/api/settings/credential-shares/${shareId}/revoke`, {
      method: "POST",
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(data.error ?? t("revokeFailed"));
      return;
    }
    await load();
  };

  const extendShare = async (shareId: string) => {
    setError(null);
    const res = await fetch(`/api/settings/credential-shares/${shareId}/extend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttlHours }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(data.error ?? t("extendFailed"));
      return;
    }
    await load();
  };

  const activeShares = shares.filter((share) =>
    ["pending", "active"].includes(share.status),
  );

  return (
    <section className="rounded-xl border border-hq-border bg-hq-surface p-4 sm:p-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-hq-fg">{t("title")}</h2>
        <p className="text-sm text-hq-fg-muted">{t("description")}</p>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-hq-fg-muted">{t("loading")}</p>
      ) : null}

      {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}

      {activeShares.length > 0 ? (
        <div className="mt-4 space-y-3">
          {activeShares.map((share) => (
            <div
              key={share.id}
              className="rounded-lg border border-hq-border bg-hq-canvas px-4 py-3 text-sm"
            >
              <div className="font-medium text-hq-fg">
                {share.status === "pending"
                  ? t("pendingInvite", {
                      name:
                        share.delegateDisplayName ??
                        share.delegateEmail ??
                        share.invitedHqUserId,
                    })
                  : t("activeShare", {
                      name:
                        share.delegateDisplayName ??
                        share.delegateEmail ??
                        t("unknownOfficer"),
                    })}
              </div>
              <div className="mt-1 text-hq-fg-muted">
                {t("capabilities", {
                  list: share.capabilities.join(", "),
                })}
              </div>
              {share.expiresAt ? (
                <div className="text-hq-fg-muted">
                  {t("expiresAt", {
                    date: new Date(share.expiresAt).toLocaleString(locale),
                  })}
                </div>
              ) : null}
              {share.lastAccessedAt ? (
                <div className="text-hq-fg-muted">
                  {t("lastAccessed", {
                    date: new Date(share.lastAccessedAt).toLocaleString(locale),
                  })}
                </div>
              ) : null}
              {canManage && share.ownerHqUserId === currentHqUserId ? (
                <div className="mt-2 flex flex-wrap gap-3">
                  {share.status === "active" ? (
                    <button
                      type="button"
                      className="text-hq-accent hover:underline"
                      onClick={() => void extendShare(share.id)}
                    >
                      {t("extend")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="text-hq-accent hover:underline"
                    onClick={() => void revokeShare(share.id)}
                  >
                    {t("revoke")}
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-hq-fg-muted">{t("empty")}</p>
      )}

      {recentActivity.length > 0 ? (
        <div className="mt-6">
          <h3 className="text-sm font-medium text-hq-fg">{t("recentActivity")}</h3>
          <ul className="mt-2 space-y-1 text-sm text-hq-fg-muted">
            {recentActivity.map((entry) => (
              <li key={entry.id}>
                {entry.action} · {new Date(entry.createdAt).toLocaleString(locale)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {canManage ? (
        <form
          className="mt-6 space-y-4 border-t border-hq-border pt-6"
          onSubmit={(event) => {
            preventDefaultFormSubmit(event);
            if (!ownerAcknowledged) {
              setError(t("ownerAckRequired"));
              return;
            }
            void createShare();
          }}
        >
          <h3 className="text-sm font-medium text-hq-fg">{t("createTitle")}</h3>

          <label className="block space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("officerLabel")}</span>
            <select
              className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2"
              value={invitedHqUserId}
              onChange={(event) => setInvitedHqUserId(event.target.value)}
              required
            >
              <option value="">{t("officerPlaceholder")}</option>
              {officers
                .filter((officer) => officer.hqUserId !== currentHqUserId)
                .map((officer) => (
                  <option key={officer.hqUserId} value={officer.hqUserId}>
                    {officer.displayName ?? officer.email} ({officer.roleName})
                  </option>
                ))}
            </select>
          </label>

          <fieldset className="space-y-2">
            <legend className="text-sm text-hq-fg-muted">{t("capabilitiesLabel")}</legend>
            {CREDENTIAL_SHARE_CAPABILITIES.map((capability) => (
              <label key={capability} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={capabilities.includes(capability)}
                  onChange={() => toggleCapability(capability)}
                />
                <span>{t(`capability.${capability}`)}</span>
              </label>
            ))}
          </fieldset>

          <label className="block space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("ttlLabel")}</span>
            <select
              className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2"
              value={ttlHours}
              onChange={(event) => setTtlHours(Number(event.target.value))}
            >
              {TTL_PRESETS.map((preset) => (
                <option key={preset.hours} value={preset.hours}>
                  {t(preset.labelKey)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-start gap-2 text-sm text-hq-fg-muted">
            <input
              type="checkbox"
              checked={ownerAcknowledged}
              onChange={(event) => setOwnerAcknowledged(event.target.checked)}
            />
            <span>{t("ownerAcknowledgment")}</span>
          </label>

          <button
            type="submit"
            disabled={creating || !invitedHqUserId}
            className="rounded-lg bg-hq-success px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {creating ? t("creating") : t("createCta")}
          </button>
        </form>
      ) : null}

      {showQr && pairingLinkUrl ? (
        <div className="mt-6 space-y-3 border-t border-hq-border pt-6">
          <CopyToClipboardField label={t("inviteLinkLabel")} value={pairingLinkUrl} />
          <div className="flex justify-center rounded-lg border border-hq-border bg-white p-4">
            <QRCodeSVG value={pairingLinkUrl} size={200} />
          </div>
          <p className="text-sm text-hq-fg-muted">{t("scanHint")}</p>
        </div>
      ) : null}
    </section>
  );
}
