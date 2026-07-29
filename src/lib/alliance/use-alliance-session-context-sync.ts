"use client";

import { useCallback, useEffect } from "react";

import {
  subscribeAllianceSessionContextChanged,
} from "@/lib/alliance/session-context-sync.shared";

type Options = {
  /** Alliance id currently shown in the picker (client state). */
  displayedAllianceId: string;
  /** When session alliance differs from displayed — reload to refresh shell + page data. */
  onStaleSession?: () => void;
};

async function fetchSessionAllianceId(): Promise<string | null> {
  const res = await fetch("/api/session/alliances");
  if (!res.ok) {
    return null;
  }
  const data = (await res.json()) as { currentAllianceId?: string | null };
  return data.currentAllianceId ?? null;
}

/**
 * Keeps alliance picker + shell in sync when another tab switches alliance context,
 * or when the user returns to a background tab after switching elsewhere.
 */
export function useAllianceSessionContextSync({
  displayedAllianceId,
  onStaleSession,
}: Options) {
  const reconcile = useCallback(async () => {
    const serverAllianceId = await fetchSessionAllianceId();
    if (!serverAllianceId) {
      return;
    }
    if (displayedAllianceId && serverAllianceId !== displayedAllianceId) {
      onStaleSession?.();
    }
  }, [displayedAllianceId, onStaleSession]);

  useEffect(() => {
    return subscribeAllianceSessionContextChanged(() => {
      void reconcile();
    });
  }, [reconcile]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void reconcile();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [reconcile]);
}
