"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";

import { useShellNavigation } from "@/components/ashed-shell/useShellNavigation";
import {
  clearAshedConnectionSessionStats,
  ensureAshedConnectionSession,
  formatConnectedSince,
  incrementAshedRequestCountSilent,
  loadAshedConnectionSessionStats,
  shouldCountAsAshedSessionRequest,
  startAshedConnectionSession,
} from "@/lib/connect/connection-session-stats.shared";
import {
  markConnectWalkthroughSeen,
  readAshedConnectedOnThisDeviceBefore,
} from "@/lib/connect/walkthrough.shared";
import {
  DEFAULT_APP_ID,
  DEFAULT_ORIGIN_URL,
  parseConnectionInput,
} from "@/lib/connectionString";

type Props = {
  isConnected: boolean;
  isAshedConnectAllowed: boolean;
  userLabel: string | null;
};

function subscribeConnectedBefore(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

export function AshedConnectionStatus({
  isConnected,
  isAshedConnectAllowed,
  userLabel,
}: Props) {
  const t = useTranslations("shell.ashedStatus");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { refresh } = useShellNavigation();
  const [open, setOpen] = React.useState(false);
  const [jwtInput, setJwtInput] = React.useState("");
  const [connecting, setConnecting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /** Bumps while the panel is open so request counts re-read from storage. */
  const [statsPoll, setStatsPoll] = React.useState(0);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const autoConnectRef = React.useRef(false);

  const hasConnectedBefore = React.useSyncExternalStore(
    subscribeConnectedBefore,
    readAshedConnectedOnThisDeviceBefore,
    () => false,
  );

  React.useEffect(() => {
    if (!isConnected) {
      return;
    }
    ensureAshedConnectionSession();

    // Prefer PerformanceObserver over patching window.fetch — wrapping fetch
    // and notifying React on every /api/* call re-renders the shell and
    // detaches interactive DOM (e2e: alliance switcher, video process panel).
    if (typeof PerformanceObserver === "undefined") {
      return;
    }

    let observer: PerformanceObserver;
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (
            entry.entryType === "resource" &&
            shouldCountAsAshedSessionRequest(entry.name)
          ) {
            incrementAshedRequestCountSilent();
          }
        }
      });
      observer.observe({ type: "resource", buffered: false });
    } catch {
      return;
    }

    return () => {
      observer.disconnect();
    };
  }, [isConnected]);

  React.useEffect(() => {
    if (!open) {
      return;
    }
    const interval = window.setInterval(() => {
      setStatsPoll((n) => n + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setError(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setError(null);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  React.useEffect(() => {
    if (open && !isConnected) {
      textareaRef.current?.focus();
    }
  }, [open, isConnected]);

  const tryAutoConnect = React.useCallback(
    async (raw: string) => {
      const parsed = parseConnectionInput(raw, {
        appId: DEFAULT_APP_ID,
        originUrl: DEFAULT_ORIGIN_URL,
      });
      if (!parsed.ok) {
        setError(null);
        return;
      }
      if (autoConnectRef.current) return;

      autoConnectRef.current = true;
      setConnecting(true);
      setError(null);

      try {
        const res = await fetch("/api/auth/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input: raw,
            appId: DEFAULT_APP_ID,
            originUrl: DEFAULT_ORIGIN_URL,
          }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          throw new Error(data.error ?? tc("connectionFailed"));
        }
        markConnectWalkthroughSeen();
        startAshedConnectionSession();
        setJwtInput("");
        setOpen(false);
        refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : tc("connectionFailed"));
      } finally {
        setConnecting(false);
        autoConnectRef.current = false;
      }
    },
    [refresh, tc],
  );

  React.useEffect(() => {
    if (!open || isConnected || !jwtInput.trim()) return;
    const parsed = parseConnectionInput(jwtInput, {
      appId: DEFAULT_APP_ID,
      originUrl: DEFAULT_ORIGIN_URL,
    });
    if (!parsed.ok) return;

    const handle = window.setTimeout(() => {
      void tryAutoConnect(jwtInput);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [jwtInput, isConnected, open, tryAutoConnect]);

  const disconnect = React.useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/auth/disconnect", { method: "POST" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? tc("disconnectFailed"));
      }
      clearAshedConnectionSessionStats();
      setOpen(false);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("disconnectFailed"));
    }
  }, [refresh, tc]);

  const showChrome =
    isAshedConnectAllowed && (isConnected || hasConnectedBefore);

  if (!showChrome) {
    return null;
  }

  // Re-read when the panel opens or when statsPoll ticks while open.
  void statsPoll;
  const liveStats = open ? loadAshedConnectionSessionStats() : null;

  return (
    <div className="relative shrink-0" ref={panelRef}>
      <button
        type="button"
        data-testid="ashed-connection-status"
        onClick={() => {
          setOpen((prev) => !prev);
          setError(null);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={
          isConnected ? t("ariaConnected") : t("ariaDisconnected")
        }
        title={isConnected ? t("titleConnected") : t("titleDisconnected")}
        className="inline-flex items-center gap-2 rounded-full border border-hq-border bg-hq-canvas px-3 py-1.5 text-xs font-medium text-hq-fg transition-colors hover:bg-hq-surface-muted"
      >
        <span
          className={`h-2 w-2 rounded-full ${
            isConnected
              ? "bg-hq-green shadow-[0_0_0_2px_rgba(63,185,80,0.25)]"
              : "bg-[#d29922] shadow-[0_0_0_2px_rgba(210,153,34,0.25)]"
          }`}
          aria-hidden
        />
        {t("label")}
      </button>

      {open ? (
        <div
          role="dialog"
          data-testid="ashed-connection-status-panel"
          className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-hq-border bg-hq-surface p-4 shadow-xl max-sm:left-0 max-sm:right-auto"
        >
          {isConnected ? (
            <>
              <p className="text-sm font-semibold text-hq-fg">
                {t("connectedHeading")}
              </p>
              {userLabel ? (
                <p className="mt-1 text-xs text-hq-fg-muted">{userLabel}</p>
              ) : null}
              <dl className="mt-3 grid gap-2 text-sm">
                <div>
                  <dt className="text-[0.65rem] uppercase tracking-wide text-hq-fg-muted">
                    {t("connectedSince")}
                  </dt>
                  <dd className="text-hq-fg">
                    {liveStats?.connectedAt
                      ? formatConnectedSince(liveStats.connectedAt, locale)
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[0.65rem] uppercase tracking-wide text-hq-fg-muted">
                    {t("requestsThisSession")}
                  </dt>
                  <dd className="text-hq-fg">
                    {liveStats?.requestCount ?? 0}
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                onClick={() => void disconnect()}
                className="mt-4 w-full rounded-lg border border-hq-danger bg-hq-danger px-3 py-2 text-sm text-white"
              >
                {t("disconnect")}
              </button>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-hq-fg">
                {t("reconnectHeading")}
              </p>
              <p className="mt-2 text-xs text-hq-fg-muted">
                {t("reconnectHint")}
              </p>
              <label className="mt-3 block text-xs text-hq-fg-muted">
                {t("jwtLabel")}
                <textarea
                  ref={textareaRef}
                  rows={4}
                  value={jwtInput}
                  disabled={connecting}
                  onChange={(e) => setJwtInput(e.target.value)}
                  placeholder={t("jwtPlaceholder")}
                  className="mt-1 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 font-mono text-xs text-hq-fg"
                />
              </label>
              {connecting ? (
                <p className="mt-2 text-xs text-hq-accent">{tc("connecting")}</p>
              ) : null}
            </>
          )}
          {error ? (
            <p className="mt-2 text-xs text-hq-danger" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
