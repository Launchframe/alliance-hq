"use client";

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";

import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";
import { buildAdminAlliancesSearchParams } from "@/lib/admin/admin-alliances-query.shared";

const SEARCH_DEBOUNCE_MS = 300;
const RESULT_LIMIT = 20;

type AdminAllianceHit = {
  id: string;
  slug: string;
  name: string;
  tag: string | null;
  gameServerNumber: number | null;
};

type Props = {
  currentAllianceId: string;
  switching: boolean;
  onSelect: (allianceId: string, activityLabel?: string | null) => void;
};

export function MaintainerAllianceSearch({
  currentAllianceId,
  switching,
  onSelect,
}: Props) {
  const t = useTranslations("alliancePicker");
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<AdminAllianceHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const next = query.trim();
      setDebouncedQuery(next);
      if (!next) {
        setResults([]);
        setSearching(false);
        setSearchError(null);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    if (!open || !debouncedQuery) {
      return;
    }

    let cancelled = false;
    void (async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const qs = buildAdminAlliancesSearchParams({
          q: debouncedQuery,
          operatingMode: "all",
          sort: "name",
          order: "asc",
          limit: RESULT_LIMIT,
          offset: 0,
        });
        const res = await fetch(`/api/admin/alliances?${qs}`);
        const data = (await res.json()) as {
          error?: string;
          alliances?: AdminAllianceHit[];
        };
        if (!res.ok) {
          throw new Error(data.error ?? t("findAllLoadFailed"));
        }
        if (cancelled) return;
        setResults(data.alliances ?? []);
      } catch (err) {
        if (!cancelled) {
          setResults([]);
          setSearchError(
            err instanceof Error ? err.message : t("findAllLoadFailed"),
          );
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, open, t]);

  return (
    <div className="mt-2 border-t border-hq-border pt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((prev) => !prev)}
        className="w-full text-left text-[11px] font-medium text-hq-fg-muted hover:text-hq-fg"
      >
        {open ? t("findAllHide") : t("findAllShow")}
      </button>
      {open ? (
        <div id={panelId} className="mt-2 space-y-2">
          <p className="text-[10px] leading-snug text-hq-fg-subtle">
            {t("findAllHint")}
          </p>
          <form
            onSubmit={(event) => {
              preventDefaultFormSubmit(event);
              const first = results[0];
              if (first && first.id !== currentAllianceId) {
                const label = first.tag?.trim() || first.slug || first.name;
                onSelect(first.id, label);
              }
            }}
          >
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("findAllSearchPlaceholder")}
              enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
              disabled={switching}
              className="w-full rounded-md border border-hq-border bg-hq-canvas px-2 py-1.5 text-xs text-hq-fg placeholder:text-hq-fg-subtle focus:border-hq-accent focus:outline-none"
              autoComplete="off"
            />
          </form>
          {searching ? (
            <p className="text-[11px] text-hq-fg-muted">{t("findAllSearching")}</p>
          ) : null}
          {searchError ? (
            <p role="alert" className="text-[11px] text-hq-danger">
              {searchError}
            </p>
          ) : null}
          {!searching && debouncedQuery && results.length === 0 && !searchError ? (
            <p className="text-[11px] text-hq-fg-muted">{t("findAllNoMatches")}</p>
          ) : null}
          {results.length > 0 ? (
            <ul className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border border-hq-border bg-hq-surface p-1">
              {results.map((alliance) => {
                const tag = alliance.tag?.trim() || alliance.slug;
                const active = alliance.id === currentAllianceId;
                return (
                  <li key={alliance.id}>
                    <button
                      type="button"
                      disabled={switching || active}
                      onClick={() => onSelect(alliance.id, tag)}
                      className="flex w-full flex-col rounded px-2 py-1.5 text-left text-xs hover:bg-hq-surface-muted disabled:cursor-default disabled:opacity-60"
                    >
                      <span className="font-medium text-hq-fg">
                        {tag}
                        {alliance.gameServerNumber != null ? (
                          <span className="ml-1 font-normal text-hq-fg-muted">
                            {t("findAllServer", {
                              server: alliance.gameServerNumber,
                            })}
                          </span>
                        ) : null}
                        {active ? (
                          <span className="ml-1 text-hq-fg-subtle">
                            ({t("activeBadge")})
                          </span>
                        ) : null}
                      </span>
                      {alliance.name && alliance.name !== tag ? (
                        <span className="truncate text-[10px] text-hq-fg-muted">
                          {alliance.name}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
