"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { CaptureDraft, CaptureDraftState } from "@/lib/notes/drafts.shared";

export function useCaptureDraft({ id, state, active, initialVersion = 0, sourceNoteId = null, sourceVersion = null }: {
  id: string; state: CaptureDraftState; active: boolean; initialVersion?: number; sourceNoteId?: string | null; sourceVersion?: number | null;
}) {
  const t = useTranslations("notes");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const version = useRef(initialVersion);
  const saved = useRef<string | null>(null);
  const queue = useRef<Promise<CaptureDraft | undefined>>(Promise.resolve(undefined));
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => { lifetime.current = new AbortController(); return () => lifetime.current?.abort(); }, []);
  const flush = useCallback((snapshot: CaptureDraftState): Promise<CaptureDraft> => {
    const serialized = JSON.stringify(snapshot);
    const operation = queue.current.catch(() => undefined).then(async (previous) => {
      if (previous && saved.current === serialized) return previous;
      const signal = lifetime.current?.signal;
      if (signal?.aborted) throw new Error(t("saveFailed"));
      setStatus("saving"); setError(null);
      try {
        const response = await fetch(`/api/notes/drafts/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, signal, body: JSON.stringify({ expectedVersion: version.current, sourceNoteId, sourceVersion, state: snapshot }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? t("saveFailed"));
        if (signal?.aborted) throw new Error(t("saveFailed"));
        version.current = result.version; saved.current = serialized; setStatus("saved");
        return result as CaptureDraft;
      } catch (failure) {
        if (!signal?.aborted) { setStatus("error"); setError(failure instanceof Error ? failure.message : t("saveFailed")); }
        throw failure;
      }
    });
    queue.current = operation;
    return operation;
  }, [id, sourceNoteId, sourceVersion, t]);
  const serialized = JSON.stringify(state);
  useEffect(() => {
    if (!active || status === "error") return;
    const timer = window.setTimeout(() => { void flush(JSON.parse(serialized)).catch(() => undefined); }, 900);
    return () => window.clearTimeout(timer);
  }, [active, serialized, flush, status]);
  async function discard() {
    await queue.current.catch(() => undefined);
    const response = await fetch(`/api/notes/drafts/${id}`, { method: "DELETE", signal: lifetime.current?.signal });
    if (!response.ok) { const result = await response.json(); throw new Error(result.error ?? t("saveFailed")); }
  }
  return { flush, discard, status, error };
}
