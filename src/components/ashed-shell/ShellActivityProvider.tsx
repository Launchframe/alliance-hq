"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { usePathname } from "@/i18n/navigation";
import {
  NAVIGATION_COMPLETE_DEBOUNCE_MS,
  type NavigationReason,
  type SessionChangeReason,
} from "@/lib/shell-activity/navigation-progress.shared";

import { ShellActivityIndicator } from "./ShellActivityIndicator";

export type ShellActivityState =
  | { kind: "idle" }
  | { kind: "navigating"; reason: NavigationReason }
  | { kind: "allianceSwitch"; tag?: string }
  | { kind: "sessionChange"; reason: SessionChangeReason };

type ShellActivityContextValue = {
  activity: ShellActivityState;
  isActive: boolean;
  beginNavigation: (reason?: NavigationReason) => void;
  beginAllianceSwitch: (tag?: string) => void;
  beginSessionChange: (reason: SessionChangeReason) => void;
  endActivity: () => void;
};

const ShellActivityContext = createContext<ShellActivityContextValue | null>(
  null,
);

type ShellActivitySearchKeySync = (searchKey: string) => void;

const ShellActivitySearchKeySyncContext =
  createContext<ShellActivitySearchKeySync | null>(null);

function isBlockingActivity(activity: ShellActivityState): boolean {
  return activity.kind === "allianceSwitch" || activity.kind === "sessionChange";
}

export function ShellActivityProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [searchKey, setSearchKey] = useState("");
  const [activity, setActivity] = useState<ShellActivityState>({ kind: "idle" });
  const activityRef = useRef(activity);
  const completeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    activityRef.current = activity;
  }, [activity]);

  const clearCompleteTimer = useCallback(() => {
    if (completeTimerRef.current) {
      clearTimeout(completeTimerRef.current);
      completeTimerRef.current = null;
    }
  }, []);

  const endActivity = useCallback(() => {
    clearCompleteTimer();
    setActivity({ kind: "idle" });
  }, [clearCompleteTimer]);

  const beginNavigation = useCallback(
    (reason: NavigationReason = "route") => {
      clearCompleteTimer();
      if (isBlockingActivity(activityRef.current)) {
        return;
      }
      setActivity({ kind: "navigating", reason });
    },
    [clearCompleteTimer],
  );

  const beginAllianceSwitch = useCallback(
    (tag?: string) => {
      clearCompleteTimer();
      setActivity({ kind: "allianceSwitch", tag });
    },
    [clearCompleteTimer],
  );

  const beginSessionChange = useCallback(
    (reason: SessionChangeReason) => {
      clearCompleteTimer();
      setActivity({ kind: "sessionChange", reason });
    },
    [clearCompleteTimer],
  );

  const syncSearchKey = useCallback((next: string) => {
    setSearchKey((current) => (current === next ? current : next));
  }, []);

  useEffect(() => {
    if (activity.kind === "allianceSwitch") {
      return;
    }
    clearCompleteTimer();
    completeTimerRef.current = setTimeout(() => {
      setActivity((current) =>
        current.kind === "navigating" || current.kind === "sessionChange"
          ? { kind: "idle" }
          : current,
      );
    }, NAVIGATION_COMPLETE_DEBOUNCE_MS);
    return clearCompleteTimer;
  }, [pathname, searchKey, activity.kind, clearCompleteTimer]);

  const value = useMemo<ShellActivityContextValue>(
    () => ({
      activity,
      isActive: activity.kind !== "idle",
      beginNavigation,
      beginAllianceSwitch,
      beginSessionChange,
      endActivity,
    }),
    [
      activity,
      beginAllianceSwitch,
      beginNavigation,
      beginSessionChange,
      endActivity,
    ],
  );

  return (
    <ShellActivityContext.Provider value={value}>
      <ShellActivitySearchKeySyncContext.Provider value={syncSearchKey}>
        <ShellActivityIndicator activity={activity} />
        {children}
      </ShellActivitySearchKeySyncContext.Provider>
    </ShellActivityContext.Provider>
  );
}

export function useShellActivitySearchKeySync(): ShellActivitySearchKeySync {
  const sync = useContext(ShellActivitySearchKeySyncContext);
  if (!sync) {
    throw new Error(
      "useShellActivitySearchKeySync must be used within ShellActivityProvider",
    );
  }
  return sync;
}

export function useShellActivity(): ShellActivityContextValue {
  const ctx = useContext(ShellActivityContext);
  if (!ctx) {
    throw new Error("useShellActivity must be used within ShellActivityProvider");
  }
  return ctx;
}

/** Safe outside provider (e.g. connect-flow layouts) — no-ops when absent. */
export function useShellActivityOptional(): ShellActivityContextValue | null {
  return useContext(ShellActivityContext);
}

export function useBeginNavigation(): (reason?: NavigationReason) => void {
  const ctx = useShellActivityOptional();
  return useCallback(
    (reason?: NavigationReason) => {
      ctx?.beginNavigation(reason);
    },
    [ctx],
  );
}
