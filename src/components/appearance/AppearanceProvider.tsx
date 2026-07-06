"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  applyResolvedAppearanceToDocument,
  readStoredAppearancePreference,
  resolveAppearance,
  writeStoredAppearancePreference,
  type AppearancePreference,
  type ResolvedAppearance,
} from "@/lib/appearance/appearance.shared";

type AppearanceContextValue = {
  preference: AppearancePreference;
  resolved: ResolvedAppearance;
  setPreference: (preference: AppearancePreference) => void;
};

const AppearanceContext = createContext<AppearanceContextValue>({
  preference: "system",
  resolved: "light",
  setPreference: () => {},
});

function readSystemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<AppearancePreference>(
    () => readStoredAppearancePreference() ?? "system",
  );
  const [prefersDark, setPrefersDark] = useState(readSystemPrefersDark);

  const resolved = useMemo(
    () => resolveAppearance(preference, prefersDark),
    [preference, prefersDark],
  );

  const setPreference = useCallback((next: AppearancePreference) => {
    setPreferenceState(next);
    writeStoredAppearancePreference(next);
  }, []);

  // Re-apply after hydration — React may strip classes the bootstrap script set on <html>.
  useLayoutEffect(() => {
    applyResolvedAppearanceToDocument(resolved);
  }, [resolved]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => {
      setPrefersDark(event.matches);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return (
    <AppearanceContext.Provider value={value}>
      {children}
    </AppearanceContext.Provider>
  );
}

export function useAppearance() {
  return useContext(AppearanceContext);
}
