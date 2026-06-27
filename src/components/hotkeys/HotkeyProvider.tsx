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
import { resolveEffectiveBindings } from "@/lib/hotkeys/resolve";
import type {
  EffectiveHotkeyBinding,
  HotkeyBindingsStore,
  HotkeyBinding,
} from "@/lib/hotkeys/types";

export type PageHotkeyHandler = () => void | boolean | Promise<void | boolean>;

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
  registerPageHandler: (actionId: string, handler: PageHotkeyHandler) => () => void;
  executeAction: (actionId: string) => Promise<void>;
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
    const res = await fetch("/api/settings/hotkeys");
    if (!res.ok) return;
    const data = (await res.json()) as {
      overrides?: HotkeyBindingsStore;
      canEdit?: boolean;
    };
    setOverrides(data.overrides ?? {});
    setCanEdit(Boolean(data.canEdit));
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
    (actionId: string, handler: PageHotkeyHandler) => {
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
    async (actionId: string) => {
      const action = getHotkeyAction(actionId);
      if (!action) return;
      if (
        !isHotkeyActionAllowed(action, new Set(sessionPermissions), permissionOptions)
      ) {
        return;
      }

      if (action.scope === "page:trains") {
        const handler = pageHandlersRef.current.get(actionId);
        if (handler) {
          await handler();
        }
        return;
      }

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
          router.push("/connect");
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
        case "custom": {
          const handler = pageHandlersRef.current.get(actionId);
          if (handler) {
            await handler();
          }
          return;
        }
        default:
          return;
      }
    },
    [
      onOpenMobileNav,
      permissionOptions,
      router,
      sessionPermissions,
      startAdminSequenceMode,
    ],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (shouldIgnoreHotkeysForEvent(event, {
        paletteOpen,
        allowPaletteChord: true,
      })) {
        return;
      }

      const parsed = parseKeyboardEvent(event);
      const onTrainsPage = pathname === "/trains" || pathname.endsWith("/trains");

      const candidateBindings = effectiveBindings.filter((entry) => {
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

      if (chordMatch) {
        event.preventDefault();
        sequenceRef.current = createSequenceState();
        void dispatchAction(chordMatch);
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

      if (sequenceMatch) {
        event.preventDefault();
        sequenceRef.current = createSequenceState();
        void dispatchAction(sequenceMatch);
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
  handlers: Record<string, PageHotkeyHandler>,
  enabled = true,
) {
  const { registerPageHandler } = useHotkeys();

  useEffect(() => {
    if (!enabled) return;
    const cleanups = Object.entries(handlers).map(([actionId, handler]) =>
      registerPageHandler(actionId, handler),
    );
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [enabled, handlers, registerPageHandler]);
}
