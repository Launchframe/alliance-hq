"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";

import type { WeekTemplateType } from "@/lib/trains/types";

export type WalkthroughAction =
  | { type: "week-template-applied"; template: WeekTemplateType }
  | { type: "day-rule-changed"; date: string; template: WeekTemplateType }
  | { type: "spin-week-finished" }
  | { type: "schedule-view-month" };

type WalkthroughContextValue = {
  active: boolean;
  sandboxActive: boolean;
  currentStepId: string | null;
  setCurrentStepId: (stepId: string | null) => void;
  sandboxWeekTemplate: WeekTemplateType | null;
  sandboxDayOverrides: Readonly<Record<string, WeekTemplateType>>;
  tryInterceptWeekTemplateApply: (template: WeekTemplateType) => boolean;
  tryInterceptDayPaint: (
    dates: string[],
    template: WeekTemplateType,
    today: string,
  ) => boolean;
  emitAction: (action: WalkthroughAction) => void;
  subscribe: (listener: (action: WalkthroughAction) => void) => () => void;
  resetSandbox: () => void;
};

export type { WalkthroughContextValue };

type SandboxVisualState = {
  weekTemplate: WeekTemplateType | null;
  dayOverrides: Record<string, WeekTemplateType>;
};

const WalkthroughContext = createContext<WalkthroughContextValue | null>(null);

export function TrainsWalkthroughProvider({
  active,
  children,
  contextRef,
  onSandboxVisualChange,
}: {
  active: boolean;
  children: ReactNode;
  contextRef?: MutableRefObject<WalkthroughContextValue | null>;
  onSandboxVisualChange?: (state: SandboxVisualState) => void;
}) {
  const [currentStepId, setCurrentStepId] = useState<string | null>(null);
  const [sandboxWeekTemplate, setSandboxWeekTemplate] =
    useState<WeekTemplateType | null>(null);
  const [sandboxDayOverrides, setSandboxDayOverrides] = useState<
    Record<string, WeekTemplateType>
  >({});
  const listenersRef = useRef(new Set<(action: WalkthroughAction) => void>());

  const sandboxActive =
    active &&
    (currentStepId === "week-template" || currentStepId === "day-long-press");

  const resetSandbox = useCallback(() => {
    setSandboxWeekTemplate(null);
    setSandboxDayOverrides({});
    setCurrentStepId(null);
    onSandboxVisualChange?.({ weekTemplate: null, dayOverrides: {} });
  }, [onSandboxVisualChange]);

  const emitAction = useCallback((action: WalkthroughAction) => {
    for (const listener of listenersRef.current) {
      listener(action);
    }
  }, []);

  const subscribe = useCallback(
    (listener: (action: WalkthroughAction) => void) => {
      listenersRef.current.add(listener);
      return () => {
        listenersRef.current.delete(listener);
      };
    },
    [],
  );

  const tryInterceptWeekTemplateApply = useCallback(
    (template: WeekTemplateType) => {
      if (!sandboxActive || currentStepId !== "week-template") return false;
      if (template !== "economy_week") return false;
      setSandboxWeekTemplate(template);
      onSandboxVisualChange?.({
        weekTemplate: template,
        dayOverrides: sandboxDayOverrides,
      });
      emitAction({ type: "week-template-applied", template });
      return true;
    },
    [
      currentStepId,
      emitAction,
      onSandboxVisualChange,
      sandboxActive,
      sandboxDayOverrides,
    ],
  );

  const tryInterceptDayPaint = useCallback(
    (dates: string[], template: WeekTemplateType, today: string) => {
      if (!sandboxActive || currentStepId !== "day-long-press") return false;
      if (!dates.includes(today)) return false;
      setSandboxDayOverrides((prev) => {
        const dayOverrides = { ...prev, [today]: template };
        onSandboxVisualChange?.({
          weekTemplate: sandboxWeekTemplate,
          dayOverrides,
        });
        return dayOverrides;
      });
      emitAction({ type: "day-rule-changed", date: today, template });
      return true;
    },
    [currentStepId, emitAction, onSandboxVisualChange, sandboxActive, sandboxWeekTemplate],
  );

  const value = useMemo(
    (): WalkthroughContextValue => ({
      active,
      sandboxActive,
      currentStepId,
      setCurrentStepId,
      sandboxWeekTemplate,
      sandboxDayOverrides,
      tryInterceptWeekTemplateApply,
      tryInterceptDayPaint,
      emitAction,
      subscribe,
      resetSandbox,
    }),
    [
      active,
      currentStepId,
      resetSandbox,
      sandboxActive,
      sandboxDayOverrides,
      sandboxWeekTemplate,
      subscribe,
      tryInterceptDayPaint,
      tryInterceptWeekTemplateApply,
      emitAction,
    ],
  );

  useEffect(() => {
    if (contextRef) {
      contextRef.current = value;
    }
  }, [contextRef, value]);

  return (
    <WalkthroughContext.Provider value={value}>
      {children}
    </WalkthroughContext.Provider>
  );
}

export function useTrainsWalkthrough(): WalkthroughContextValue | null {
  return useContext(WalkthroughContext);
}
