"use client";

import { useCallback } from "react";

import { useRouter } from "@/i18n/navigation";
import type {
  NavigationReason,
  SessionChangeReason,
} from "@/lib/shell-activity/navigation-progress.shared";

import { useShellActivityOptional } from "./ShellActivityProvider";

export function useShellNavigation() {
  const shell = useShellActivityOptional();
  const router = useRouter();

  const beginNavigation = useCallback(
    (reason: NavigationReason = "route") => {
      shell?.beginNavigation(reason);
    },
    [shell],
  );

  const beginSessionChange = useCallback(
    (reason: SessionChangeReason) => {
      shell?.beginSessionChange(reason);
    },
    [shell],
  );

  const push = useCallback(
    (href: string, reason: NavigationReason = "route") => {
      shell?.beginNavigation(reason);
      router.push(href);
    },
    [router, shell],
  );

  const pushAndRefresh = useCallback(
    (href: string, sessionReason?: SessionChangeReason) => {
      if (sessionReason) {
        shell?.beginSessionChange(sessionReason);
      } else {
        shell?.beginNavigation("refresh");
      }
      router.push(href);
      router.refresh();
    },
    [router, shell],
  );

  const replaceLocale = useCallback(
    (href: string, locale: string) => {
      shell?.beginNavigation("locale");
      router.replace(href, { locale });
    },
    [router, shell],
  );

  const assign = useCallback(
    (href: string, sessionReason: SessionChangeReason) => {
      shell?.beginSessionChange(sessionReason);
      window.location.assign(href);
    },
    [shell],
  );

  const refresh = useCallback(() => {
    shell?.beginNavigation("refresh");
    router.refresh();
    window.setTimeout(() => shell?.endActivity(), 1500);
  }, [router, shell]);

  return {
    beginNavigation,
    beginSessionChange,
    push,
    pushAndRefresh,
    replaceLocale,
    assign,
    refresh,
    router,
  };
}
