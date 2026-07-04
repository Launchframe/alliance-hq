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

import { usePathname, useRouter } from "@/i18n/navigation";
import {
  buildConnectHref,
  stashConnectReturnPath,
} from "@/lib/connect/connect-return-path.shared";
import {
  getHotkeyAction,
  isHotkeyActionAllowed,
  listVisibleHotkeyActions,
} from "@/lib/hotkeys/actions.registry";
import {
  advanceSequenceState,
  createSequenceState,
  findMatchingActionId,
  parseKeyboardEvent,
  shouldIgnoreHotkeysForEvent,
} from "@/lib/hotkeys/engine";
import { safeRunHotkeyDispatch, safeRunHotkeyHandler } from "@/lib/hotkeys/safe-execute.shared";
import {
  isKnownHotkeyActionId,
  sanitizeHotkeyOverrides,
  type HotkeyActionId,
} from "@/lib/hotkeys/registry-integrity.shared";
import { resolveEffectiveBindings } from "@/lib/hotkeys/resolve";
import type {
  EffectiveHotkeyBinding,
  HotkeyBindingsStore,
  HotkeyBinding,
  PageHotkeyHandler,
} from "@/lib/hotkeys/types";

export type { PageHotkeyHandler } from "@/lib/hotkeys/types";

type HotkeyContextValue = {
  paletteOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;
  adminSequenceMode: boolean;
  effectiveBindings: EffectiveHotkeyBinding[];
  overrides: HotkeyBindingsStore;
  canEdit: boolean;
  saveBinding: (actionId: string, binding: HotkeyBinding) => Promise<string | null>;
  resetBinding: (actionId: string | "all") => Promise<string | null>;
  registerPageHandler: (actionId: HotkeyActionId, handler: PageHotkeyHandler) => () => void;
  executeAction: (actionId: HotkeyActionId) => Promise<void>;
};

const HotkeyContext = createContext<HotkeyContextValue | null>(null);

const ADMIN_SEQUENCE_TIMEOUT_MS = 5000;

type Props = {
  children: ReactNode;
  sessionPermissions: readonly string[];
  isConnected: boolean;
  operatingMode?: "ashed" | "native" | null;
  showVideoQueue?: boolean;
  onOpenMobileNav?: () => void;
};

export function HotkeyProvider({
  children,
  sessionPermissions,
  isConnected,
  operatingMode = null,
  showVideoQueue = false,
  onOpenMobileNav,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [adminSequenceMode, setAdminSequenceMode] = useState(false);
  const [overrides, setOverrides] = useState<HotkeyBindingsStore>({});
  const [canEdit, setCanEdit] = useState(false);
  const sequenceRef = useRef(createSequenceState());
  const pageHandlersRef = useRef(new Map<string, PageHotkeyHandler>());
  const adminSequenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const permissionOptions = useMemo(
    () => ({
      isConnected,
      operatingMode,
      showVideoQueue,
    }),
    [isConnected, operatingMode, showVideoQueue],
  );

  const visibleActions = useMemo(
    () => listVisibleHotkeyActions(sessionPermissions, permissionOptions),
    [sessionPermissions, permissionOptions],
  );

  const visibleActionIds = useMemo(
    () => new Set(visibleActions.map((action) => action.id)),
    [visibleActions],
  );

  const effectiveBindings = useMemo(() => {
    return resolveEffectiveBindings(overrides).filter((entry) =>
      visibleActionIds.has(entry.actionId),
    );
  }, [overrides, visibleActionIds]);

  const loadBindings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/hotkeys");
      if (!res.ok) return;
      const data = (await res.json()) as {
        overrides?: HotkeyBindingsStore;
        canEdit?: boolean;
      };
      setOverrides(sanitizeHotkeyOverrides(data.overrides ?? {}));
      setCanEdit(Boolean(data.canEdit));
    } catch {
      // Hotkey prefs are optional — never break the shell.
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadBindings();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadBindings]);

  const startAdminSequenceMode = useCallback(() => {
    setAdminSequenceMode(true);
    if (adminSequenceTimerRef.current) {
      clearTimeout(adminSequenceTimerRef.current);
    }
    adminSequenceTimerRef.current = setTimeout(() => {
      setAdminSequenceMode(false);
      adminSequenceTimerRef.current = null;
    }, ADMIN_SEQUENCE_TIMEOUT_MS);
  }, []);

  const registerPageHandler = useCallback(
    (actionId: HotkeyActionId, handler: PageHotkeyHandler) => {
      pageHandlersRef.current.set(actionId, handler);
      return () => {
        pageHandlersRef.current.delete(actionId);
      };
    },
    [],
  );

  const saveBinding = useCallback(
    async (actionId: string, binding: HotkeyBinding) => {
      const res = await fetch("/api/settings/hotkeys", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId, binding }),
      });
      const data = (await res.json()) as {
        error?: string;
        overrides?: HotkeyBindingsStore;
      };
      if (!res.ok) {
        return data.error ?? "Failed to save shortcut.";
      }
      setOverrides(data.overrides ?? {});
      return null;
    },
    [],
  );

  const resetBinding = useCallback(async (actionId: string | "all") => {
    const res = await fetch("/api/settings/hotkeys", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reset: actionId }),
    });
    const data = (await res.json()) as {
      error?: string;
      overrides?: HotkeyBindingsStore;
    };
    if (!res.ok) {
      return data.error ?? "Failed to reset shortcut.";
    }
    setOverrides(data.overrides ?? {});
    return null;
  }, []);

  const dispatchAction = useCallback(
    async (actionId: HotkeyActionId) => {
      const action = getHotkeyAction(actionId);
      if (!action) return;
      if (
        !isHotkeyActionAllowed(action, new Set(sessionPermissions), permissionOptions)
      ) {
        return;
      }

      if (action.scope === "page:trains" || action.kind === "custom") {
        await safeRunHotkeyHandler(
          actionId,
          pageHandlersRef.current.get(actionId),
        );
        return;
      }

      try {
        switch (action.kind) {
          case "open-palette":
            setPaletteOpen(true);
            return;
          case "open-hotkey-reference":
            router.push("/settings/hotkeys");
            return;
          case "focus-sidebar":
            onOpenMobileNav?.();
            return;
          case "connect-ashed":
            stashConnectReturnPath(pathname);
            router.push(buildConnectHref(pathname));
            return;
          case "admin-sequence-start":
            if (action.href) {
              router.push(action.href);
            }
            startAdminSequenceMode();
            return;
          case "navigate":
            if (action.href) {
              router.push(action.href);
            }
            return;
          default:
            return;
        }
      } catch (error) {
        if (process.env.NODE_ENV === "development") {
          console.error(`[hotkeys] Dispatch failed for action: ${actionId}`, error);
        }
      }
    },
    [
      onOpenMobileNav,
      pathname,
      permissionOptions,
      router,
      sessionPermissions,
      startAdminSequenceMode,
    ],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      try {
        if (shouldIgnoreHotkeysForEvent(event, {
          paletteOpen,
          allowPaletteChord: true,
        })) {
          return;
        }

        const parsed = parseKeyboardEvent(event);
        const onTrainsPage =
          pathname === "/trains" || pathname.endsWith("/trains");

        const candidateBindings = effectiveBindings.filter((entry) => {
          if (!isKnownHotkeyActionId(entry.actionId)) return false;
          const action = getHotkeyAction(entry.actionId);
          if (!action) return false;
          if (adminSequenceMode) {
            return action.scope === "admin-sequence";
          }
          if (action.scope === "admin-sequence") {
            return false;
          }
          if (action.scope === "page:trains" && !onTrainsPage) {
            return false;
          }
          return true;
        });

        const chordMatch = findMatchingActionId(
          candidateBindings,
          parsed,
          [],
        );

        if (chordMatch && isKnownHotkeyActionId(chordMatch)) {
          event.preventDefault();
          sequenceRef.current = createSequenceState();
          safeRunHotkeyDispatch(chordMatch, () => dispatchAction(chordMatch));
          return;
        }

        const nextSequence = advanceSequenceState(
          sequenceRef.current,
          parsed,
        );
        sequenceRef.current = nextSequence;

        const sequenceMatch = findMatchingActionId(
          candidateBindings,
          parsed,
          nextSequence.keys,
        );

        if (sequenceMatch && isKnownHotkeyActionId(sequenceMatch)) {
          event.preventDefault();
          sequenceRef.current = createSequenceState();
          safeRunHotkeyDispatch(sequenceMatch, () =>
            dispatchAction(sequenceMatch),
          );
        }
      } catch (error) {
        if (process.env.NODE_ENV === "development") {
          console.error("[hotkeys] Keydown listener failed", error);
        }
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [
    adminSequenceMode,
    dispatchAction,
    effectiveBindings,
    paletteOpen,
    pathname,
  ]);

  useEffect(() => {
    return () => {
      if (adminSequenceTimerRef.current) {
        clearTimeout(adminSequenceTimerRef.current);
      }
    };
  }, []);

  const value = useMemo<HotkeyContextValue>(
    () => ({
      paletteOpen,
      openPalette: () => setPaletteOpen(true),
      closePalette: () => setPaletteOpen(false),
      adminSequenceMode,
      effectiveBindings,
      overrides,
      canEdit,
      saveBinding,
      resetBinding,
      registerPageHandler,
      executeAction: dispatchAction,
    }),
    [
      adminSequenceMode,
      canEdit,
      effectiveBindings,
      overrides,
      paletteOpen,
      registerPageHandler,
      resetBinding,
      saveBinding,
      dispatchAction,
    ],
  );

  return (
    <HotkeyContext.Provider value={value}>{children}</HotkeyContext.Provider>
  );
}

export function useHotkeys(): HotkeyContextValue {
  const context = useContext(HotkeyContext);
  if (!context) {
    throw new Error("useHotkeys must be used within HotkeyProvider");
  }
  return context;
}

export function useRegisterPageHotkeys(
  handlers: Partial<Record<HotkeyActionId, PageHotkeyHandler>>,
  enabled = true,
) {
  const { registerPageHandler } = useHotkeys();

  useEffect(() => {
    if (!enabled) return;
    const cleanups = (
      Object.entries(handlers) as Array<
        [HotkeyActionId, PageHotkeyHandler | undefined]
      >
    )
      .filter((entry): entry is [HotkeyActionId, PageHotkeyHandler] =>
        Boolean(entry[1]),
      )
      .map(([actionId, handler]) => registerPageHandler(actionId, handler));
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [enabled, handlers, registerPageHandler]);
}
