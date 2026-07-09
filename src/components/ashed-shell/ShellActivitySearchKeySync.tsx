"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

import { useShellActivitySearchKeySync } from "./ShellActivityProvider";

/** Isolated so useSearchParams does not suspend the full shell tree. */
export function ShellActivitySearchKeySync() {
  const searchParams = useSearchParams();
  const syncSearchKey = useShellActivitySearchKeySync();

  useEffect(() => {
    syncSearchKey(searchParams.toString());
  }, [searchParams, syncSearchKey]);

  return null;
}
