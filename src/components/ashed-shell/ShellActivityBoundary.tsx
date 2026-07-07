"use client";

import { Suspense, type ReactNode } from "react";

import { ShellActivityProvider } from "./ShellActivityProvider";
import { ShellActivitySearchKeySync } from "./ShellActivitySearchKeySync";

export function ShellActivityBoundary({ children }: { children: ReactNode }) {
  return (
    <ShellActivityProvider>
      <Suspense fallback={null}>
        <ShellActivitySearchKeySync />
      </Suspense>
      {children}
    </ShellActivityProvider>
  );
}
