"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { APP_VERSION } from "@/lib/feedback/constants";
import type { ReleaseNoteEntry } from "@/lib/release-notes/types";
import {
  compareAppVersions,
  hasUnreadReleaseNotes,
  lastSeenReleaseVersionStorageKey,
} from "@/lib/release-notes/version";
import { ReleaseNoteMarkdown } from "@/components/release-notes/ReleaseNoteMarkdown";
import { ReleaseNotesPeekBar } from "@/components/release-notes/ReleaseNotesPeekBar";

type ReleaseNotesResponse = {
  currentVersion: string;
  entries: ReleaseNoteEntry[];
};

type ReleaseNotesContextValue = {
  canOpenReleaseNotes: boolean;
  openReleaseNotes: () => void;
  releaseNotesReady: boolean;
  hasUnread: boolean;
  dismissReleaseNotes: () => void;
};

const ReleaseNotesContext =
  React.createContext<ReleaseNotesContextValue | null>(null);

export function useReleaseNotes(): ReleaseNotesContextValue {
  const value = React.useContext(ReleaseNotesContext);
  return (
    value ?? {
      canOpenReleaseNotes: false,
      openReleaseNotes: () => {},
      releaseNotesReady: false,
      hasUnread: false,
      dismissReleaseNotes: () => {},
    }
  );
}

function ReleaseNoteSection({
  heading,
  bullets,
}: {
  heading: string;
  bullets: string[];
}) {
  if (bullets.length === 0) {
    return null;
  }

  return (
    <div className="min-w-0 space-y-2">
      <h4 className="text-sm font-semibold text-[#e6edf3]">{heading}</h4>
      <ul className="list-disc space-y-1 pl-5 text-sm text-[#8b949e]">
        {bullets.map((bullet, index) => (
          <li key={`${heading}-${index}`} className="min-w-0 whitespace-normal">
            <ReleaseNoteMarkdown markdown={bullet} />
          </li>
        ))}
      </ul>
    </div>
  );
}

type ProviderProps = {
  sessionId: string;
  children: React.ReactNode;
};

export function ReleaseNotesProvider({ sessionId, children }: ProviderProps) {
  const t = useTranslations("releaseNotes");
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [peekOpen, setPeekOpen] = React.useState(false);
  const [entries, setEntries] = React.useState<ReleaseNoteEntry[]>([]);
  const [currentVersion, setCurrentVersion] = React.useState<string | undefined>();
  const [fetched, setFetched] = React.useState(false);
  const [hasUnread, setHasUnread] = React.useState(false);
  const fullyDismissRef = React.useRef(false);

  const storageKey = React.useMemo(
    () => lastSeenReleaseVersionStorageKey(sessionId),
    [sessionId],
  );

  const fetchReleaseNotes = React.useCallback(async () => {
    const params = new URLSearchParams({ current: APP_VERSION });
    try {
      const response = await fetch(`/api/release-notes?${params.toString()}`);
      if (!response.ok) {
        return null;
      }
      return (await response.json()) as ReleaseNotesResponse;
    } catch {
      return null;
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    const lastSeen =
      typeof window !== "undefined"
        ? window.localStorage.getItem(storageKey)
        : null;

    void fetchReleaseNotes()
      .then((payload) => {
        if (cancelled || !payload) {
          return;
        }

        setCurrentVersion(payload.currentVersion);
        setEntries(payload.entries);

        const unread = hasUnreadReleaseNotes(
          lastSeen,
          payload.currentVersion,
          payload.entries,
        );
        setHasUnread(unread);

        if (unread && payload.entries.length > 0) {
          setPeekOpen(false);
          setDrawerOpen(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setFetched(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fetchReleaseNotes, storageKey]);

  const markSeen = React.useCallback(() => {
    const version = currentVersion ?? APP_VERSION;
    window.localStorage.setItem(storageKey, version);
    setHasUnread(false);
  }, [currentVersion, storageKey]);

  const openReleaseNotes = React.useCallback(() => {
    if (entries.length === 0) {
      return;
    }
    setPeekOpen(false);
    setDrawerOpen(true);
  }, [entries.length]);

  const dismissReleaseNotes = React.useCallback(() => {
    markSeen();
    fullyDismissRef.current = true;
    setPeekOpen(false);
    setDrawerOpen(false);
  }, [markSeen]);

  const handleDrawerOpenChange = React.useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      setPeekOpen(false);
      setDrawerOpen(true);
      return;
    }

    if (fullyDismissRef.current) {
      fullyDismissRef.current = false;
      setPeekOpen(false);
      setDrawerOpen(false);
      return;
    }

    setDrawerOpen(false);
    setPeekOpen(true);
  }, []);

  const displayEntries = React.useMemo(
    () =>
      [...entries].sort((a, b) => compareAppVersions(b.version, a.version)),
    [entries],
  );

  const contextValue = React.useMemo(
    () => ({
      canOpenReleaseNotes: entries.length > 0,
      openReleaseNotes,
      releaseNotesReady: fetched && entries.length > 0,
      hasUnread,
      dismissReleaseNotes,
    }),
    [
      dismissReleaseNotes,
      entries.length,
      fetched,
      hasUnread,
      openReleaseNotes,
    ],
  );

  const showDrawerChrome = entries.length > 0 && (drawerOpen || peekOpen);

  return (
    <ReleaseNotesContext.Provider value={contextValue}>
      {children}

      {peekOpen && !drawerOpen ? (
        <ReleaseNotesPeekBar
          onExpand={openReleaseNotes}
          label={t("expandDrawer")}
          expandHintDesktop={t("peekExpandDesktop")}
          expandHintMobile={t("peekExpandMobile")}
        />
      ) : null}

      {showDrawerChrome && drawerOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center"
          role="dialog"
          aria-modal="true"
          aria-label={t("drawerTitle")}
          data-testid="hq-release-notes-drawer"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/70"
            aria-label={t("closeDrawer")}
            onClick={() => handleDrawerOpenChange(false)}
          />
          <div className="relative z-[101] flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-2xl border border-[#30363d] bg-[#161b22] shadow-xl sm:rounded-2xl">
            <div className="mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full bg-[#484f58]" />
            <div className="shrink-0 border-b border-[#30363d] px-4 pb-4 pt-3 text-left">
              <h2 className="text-lg font-semibold text-[#e6edf3]">
                {t("drawerTitle")}
              </h2>
              <p className="text-sm text-[#8b949e]">
                {t("drawerSubtitle", {
                  version: currentVersion ?? APP_VERSION,
                })}
              </p>
            </div>

            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-4">
              {displayEntries.map((entry) => (
                <section
                  key={entry.version}
                  className="min-w-0 space-y-3 border-b border-[#30363d] pb-6 last:border-b-0 last:pb-0"
                >
                  <div>
                    <h3 className="text-base font-semibold text-[#e6edf3]">
                      {entry.title}
                    </h3>
                    <p className="text-xs text-[#8b949e]">
                      v{entry.version}
                      {entry.shippedAt
                        ? ` · ${entry.shippedAt.slice(0, 10)}`
                        : ""}
                    </p>
                  </div>

                  {entry.summary ? (
                    <ReleaseNoteMarkdown markdown={entry.summary} />
                  ) : null}

                  <ReleaseNoteSection
                    heading={t("breakingHeading")}
                    bullets={entry.breaking ?? []}
                  />
                  <ReleaseNoteSection
                    heading={t("maintainerHeading")}
                    bullets={entry.maintainerNotes ?? []}
                  />
                </section>
              ))}
            </div>

            <div className="shrink-0 space-y-3 border-t border-[#30363d] px-4 py-4">
              <Link
                href="/releases"
                className="block text-center text-sm font-medium underline text-[#58a6ff] hover:text-[#ffd58d]"
                onClick={() => {
                  fullyDismissRef.current = true;
                  setDrawerOpen(false);
                  setPeekOpen(false);
                }}
              >
                {t("historyLink")}
              </Link>
              <button
                type="button"
                className="w-full rounded-lg bg-[#238636] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#2ea043]"
                onClick={dismissReleaseNotes}
                data-testid="hq-release-notes-dismiss"
              >
                {t("gotIt")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ReleaseNotesContext.Provider>
  );
}
