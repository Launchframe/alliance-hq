"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { AppSelect } from "@/components/ui/AppSelect";
import {
  buildAdminUidInspectorSearchParams,
  validateAdminUidInspectorGameUid,
} from "@/lib/admin/admin-uid-inspector-query.shared";
import type { AdminUidInspectorResult } from "@/lib/admin/admin-uid-inspector.shared";

type AllianceOption = {
  id: string;
  name: string;
  slug: string;
  tag: string | null;
};

function allianceLabel(row: {
  allianceName?: string;
  allianceSlug?: string;
  allianceTag: string | null;
}): string {
  const tag = row.allianceTag?.trim();
  if (tag && row.allianceSlug) return `${tag} (${row.allianceSlug})`;
  return row.allianceName ?? row.allianceTag ?? "—";
}

function Section({
  title,
  children,
  empty,
}: {
  title: string;
  children?: ReactNode;
  empty?: boolean;
}) {
  return (
    <section className="rounded-xl border border-hq-border bg-hq-surface p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-hq-fg-muted">
        {title}
      </h2>
      {empty ? (
        <p className="mt-3 text-sm text-hq-fg-muted">—</p>
      ) : (
        <div className="mt-3">{children}</div>
      )}
    </section>
  );
}

export function AdminUidInspectorConsole() {
  const t = useTranslations("admin.uidInspectorPage");
  const [alliances, setAlliances] = useState<AllianceOption[]>([]);
  const [gameUidInput, setGameUidInput] = useState("");
  const [allianceForRoster, setAllianceForRoster] = useState("");
  const [result, setResult] = useState<AdminUidInspectorResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAlliances = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/uid-inspector");
      if (!res.ok) return;
      const data = (await res.json()) as { alliances: AllianceOption[] };
      setAlliances(data.alliances ?? []);
    } catch {
      /* picker is optional until search */
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAlliances();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadAlliances]);

  const runSearch = useCallback(async () => {
    const normalized = gameUidInput.trim().replace(/\s+/g, "");
    const validated = validateAdminUidInspectorGameUid(normalized);
    if (!validated.ok) {
      setError(
        validated.error === "invalid" ? t("invalidUid") : t("uidRequired"),
      );
      setResult(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const qs = buildAdminUidInspectorSearchParams({
        gameUid: validated.gameUid,
        allianceIdForRoster: allianceForRoster || undefined,
      });
      const res = await fetch(`/api/admin/uid-inspector?${qs}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (body?.error === "invalid_uid") {
          throw new Error(t("invalidUid"));
        }
        throw new Error(await res.text());
      }
      const data = (await res.json()) as AdminUidInspectorResult;
      setResult(data);
      if (data.alliances.length > 0) {
        setAlliances(data.alliances);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadFailed"));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [allianceForRoster, gameUidInput, t]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-hq-fg-muted">{t("subtitle")}</p>
        <p className="mt-2 text-sm text-hq-fg-subtle">{t("privacyNote")}</p>
      </div>

      <section className="space-y-4 rounded-xl border border-hq-border bg-hq-surface p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={gameUidInput}
            onChange={(e) => setGameUidInput(e.target.value)}
            placeholder={t("uidPlaceholder")}
            className="min-w-0 flex-1 rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 font-mono text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter") void runSearch();
            }}
          />
          <AppSelect
            value={allianceForRoster}
            onChange={setAllianceForRoster}
            options={[
              { value: "", label: t("rosterAllianceOptional") },
              ...alliances.map((alliance) => ({
                value: alliance.id,
                label: allianceLabel({
                  allianceName: alliance.name,
                  allianceSlug: alliance.slug,
                  allianceTag: alliance.tag,
                }),
              })),
            ]}
          />
          <button
            type="button"
            onClick={() => void runSearch()}
            disabled={loading}
            className="rounded-lg bg-hq-accent px-4 py-2 text-sm font-medium text-hq-accent-fg disabled:opacity-50"
          >
            {loading ? t("loading") : t("search")}
          </button>
        </div>
        {error ? <p className="text-sm text-hq-danger">{error}</p> : null}
      </section>

      {result ? (
        <div className="space-y-4">
          <Section title={t("lastWarTitle")}>
            {result.lastWarLookup.ok ? (
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-hq-fg-subtle">{t("verifiedName")}</dt>
                  <dd className="font-medium">{result.lastWarLookup.gameUserName}</dd>
                </div>
                {result.lastWarLookup.gameUserLevel != null ? (
                  <div>
                    <dt className="text-xs text-hq-fg-subtle">{t("level")}</dt>
                    <dd>{result.lastWarLookup.gameUserLevel}</dd>
                  </div>
                ) : null}
                {result.lastWarLookup.gameServerNumber != null ? (
                  <div>
                    <dt className="text-xs text-hq-fg-subtle">{t("server")}</dt>
                    <dd>{result.lastWarLookup.gameServerNumber}</dd>
                  </div>
                ) : null}
                <div className="sm:col-span-2">
                  <dt className="text-xs text-hq-fg-subtle">{t("gameUid")}</dt>
                  <dd className="font-mono">{result.gameUid}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-hq-danger">
                {result.lastWarLookup.message || t("lookupFailed")}
              </p>
            )}
          </Section>

          {result.rosterSuggestions ? (
            <Section
              title={t("rosterSuggestionsTitle", {
                tag: result.rosterSuggestions.allianceTag ?? "?",
              })}
            >
              <p className="mb-3 text-xs text-hq-fg-muted">
                {t("rosterMeta", {
                  count: result.rosterSuggestions.rosterCount,
                  source: result.rosterSuggestions.rosterSource,
                })}
              </p>
              {result.rosterSuggestions.exactMatch ? (
                <p className="text-sm">
                  {t("exactMatch", {
                    name: result.rosterSuggestions.exactMatch.memberName,
                    linked: result.rosterSuggestions.exactMatch.isLinked
                      ? t("linkedYes")
                      : t("linkedNo"),
                  })}
                </p>
              ) : (
                <p className="text-sm text-hq-fg-muted">{t("noExactMatch")}</p>
              )}
              {result.rosterSuggestions.substringSuggestion ? (
                <p className="mt-2 text-sm">
                  {t("substringSuggestion", {
                    rosterName:
                      result.rosterSuggestions.substringSuggestion
                        .matchedRosterName,
                    memberName:
                      result.rosterSuggestions.substringSuggestion.memberName,
                  })}
                </p>
              ) : null}
              {result.rosterSuggestions.fuzzyCandidates.length > 0 ? (
                <ul className="mt-3 space-y-1 text-sm">
                  {result.rosterSuggestions.fuzzyCandidates.map((row) => (
                    <li key={row.ashedMemberId}>
                      {row.memberName}
                      <span className="ml-2 text-xs text-hq-fg-muted">
                        ({t("fuzzyScore", { score: Math.round(row.score * 100) })}
                        {row.matchedRosterName !== row.memberName
                          ? ` · ${row.matchedRosterName}`
                          : ""}
                        )
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-hq-fg-muted">{t("noFuzzy")}</p>
              )}
            </Section>
          ) : allianceForRoster && result.lastWarLookup.ok === false ? (
            <Section title={t("rosterSuggestionsTitleGeneric")} empty />
          ) : null}

          <Section
            title={t("hqLinksTitle")}
            empty={result.hqMemberLinks.length === 0}
          >
            <ul className="space-y-3 text-sm">
              {result.hqMemberLinks.map((row) => (
                <li
                  key={row.id}
                  className="rounded-lg border border-hq-border/60 bg-hq-canvas p-3"
                >
                  <p className="font-medium">
                    {row.memberDisplayName ?? row.ashedMemberId}
                  </p>
                  <p className="text-hq-fg-muted">{allianceLabel(row)}</p>
                  <p>
                    {row.hqUserDisplayName ?? row.hqUserEmail ?? row.hqUserId}
                  </p>
                  <p className="text-xs text-hq-fg-subtle">
                    {t("linkedAt", {
                      date: new Date(row.linkedAt).toLocaleString(),
                    })}
                  </p>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            title={t("discordLinksTitle")}
            empty={result.discordMemberLinks.length === 0}
          >
            <ul className="space-y-3 text-sm">
              {result.discordMemberLinks.map((row) => (
                <li
                  key={row.id}
                  className="rounded-lg border border-hq-border/60 bg-hq-canvas p-3"
                >
                  <p className="font-medium">
                    {row.memberDisplayName ?? row.ashedMemberId}
                  </p>
                  <p className="text-hq-fg-muted">{allianceLabel(row)}</p>
                  <p>{row.discordUsername ?? row.discordUserId}</p>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            title={t("rosterMembersTitle")}
            empty={result.allianceMembers.length === 0}
          >
            <ul className="space-y-2 text-sm">
              {result.allianceMembers.map((row) => (
                <li key={`${row.allianceId}-${row.ashedMemberId}`}>
                  <span className="font-medium">{row.currentName}</span>
                  <span className="text-hq-fg-muted">
                    {" "}
                    · {allianceLabel(row)} · {row.status}
                  </span>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            title={t("onboardingReviewsTitle")}
            empty={result.onboardingReviews.length === 0}
          >
            <ul className="space-y-2 text-sm">
              {result.onboardingReviews.map((row) => (
                <li key={row.id}>
                  <span className="font-medium">{row.status}</span>
                  {" · "}
                  {allianceLabel(row)}
                  {" · "}
                  {row.gameUserName}
                </li>
              ))}
            </ul>
          </Section>

          <Section
            title={t("rosterRequestsTitle")}
            empty={result.rosterLinkRequests.length === 0}
          >
            <ul className="space-y-3 text-sm">
              {result.rosterLinkRequests.map((row) => (
                <li
                  key={row.id}
                  className="rounded-lg border border-hq-border/60 bg-hq-canvas p-3"
                >
                  <p>
                    <span className="font-medium">{row.status}</span>
                    {" · "}
                    {allianceLabel(row)}
                  </p>
                  <p>
                    {t("reportedVsVerified", {
                      reported: row.reportedName,
                      verified: row.gameUserName,
                    })}
                  </p>
                  {row.suggestedTargetAshedMemberId ? (
                    <p className="text-xs text-hq-fg-muted">
                      {t("suggestion", {
                        method: row.suggestionMethod ?? "?",
                        name: row.suggestedMatchedRosterName ?? "?",
                      })}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </Section>

          <Section
            title={t("helpRequestsTitle")}
            empty={result.memberLinkHelpRequests.length === 0}
          >
            <ul className="space-y-3 text-sm">
              {result.memberLinkHelpRequests.map((row) => (
                <li key={row.id}>
                  <Link
                    href={`/admin/member-link-help/${row.id}`}
                    className="block rounded-lg border border-hq-border/60 bg-hq-canvas p-3 hover:bg-hq-surface-elevated"
                  >
                    <p>
                      <span className="font-medium">{row.status}</span>
                      {" · "}
                      {row.context}
                    </p>
                    <p className="text-hq-fg-muted">{row.requesterHandle}</p>
                    {row.claimConflictReason ? (
                      <p className="text-xs text-hq-danger">
                        {t("claimConflict", { reason: row.claimConflictReason })}
                      </p>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            title={t("discordAuditTitle")}
            empty={result.recentDiscordAudit.length === 0}
          >
            <ul className="space-y-3 text-sm">
              {result.recentDiscordAudit.map((row) => (
                <li
                  key={row.id}
                  className="rounded-lg border border-hq-border/60 bg-hq-canvas p-3"
                >
                  <p>
                    <span className="font-medium">{row.command}</span>
                    {" · "}
                    {row.allianceTag ?? row.allianceId}
                  </p>
                  <p className="text-xs text-hq-fg-muted">
                    {new Date(row.createdAt).toLocaleString()}
                    {row.discordUserId ? ` · ${row.discordUserId}` : ""}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-2 text-xs">
                    {row.memberTaken ? (
                      <span className="rounded bg-hq-danger/15 px-1.5 py-0.5 text-hq-danger">
                        {t("flagMemberTaken")}
                      </span>
                    ) : null}
                    {row.linked ? (
                      <span className="rounded bg-hq-success/15 px-1.5 py-0.5">
                        {t("flagLinked")}
                      </span>
                    ) : null}
                    {row.needsOfficerAttention ? (
                      <span className="rounded bg-hq-warning/15 px-1.5 py-0.5">
                        {t("flagOfficer")}
                      </span>
                    ) : null}
                  </p>
                  {row.replyPreview ? (
                    <p className="mt-1 text-xs text-hq-fg-subtle">{row.replyPreview}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </Section>

          <p className="text-xs text-hq-fg-subtle">{t("symptomsHint")}</p>
        </div>
      ) : null}
    </div>
  );
}
