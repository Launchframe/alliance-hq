"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useNotesFetch } from "./NotesNavigation";
import type { NoteWorkspaceState, WorkspacePreferences } from "@/lib/notes/workspace.shared";

export function useWorkspacePreferences(initial: WorkspacePreferences, state: NoteWorkspaceState, onRevoked: () => void) {
  const t = useTranslations("notes.workspace");
  const fetchNotes = useNotesFetch();
  const [error, setError] = useState<string | null>(null), [saving, setSaving] = useState(false);
  const latest = useRef(state), version = useRef(initial.version), saved = useRef(JSON.stringify(initial.state));
  const queue = useRef(Promise.resolve());
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => { lifetime.current = new AbortController(); return () => lifetime.current?.abort(); }, []);
  useEffect(() => { latest.current = state; }, [state]);
  const save = useCallback(() => {
    const operation = queue.current.catch(() => undefined).then(async () => {
      const signal = lifetime.current?.signal;
      if (!signal || signal.aborted) return;
      const snapshot = latest.current, serialized = JSON.stringify(snapshot);
      if (serialized === saved.current) return;
      setSaving(true); setError(null);
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const response = await fetchNotes("/api/notes/preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, cache: "no-store", signal,
            body: JSON.stringify({ expectedScope: initial.scope, expectedVersion: version.current, state: snapshot }) });
          const body = await response.json();
          if (signal.aborted) return;
          if ([401, 403].includes(response.status) || response.ok && body.scope !== initial.scope) { onRevoked(); throw new Error(); }
          if (response.status === 409 && attempt === 0) {
            const fresh = await fetchNotes("/api/notes/preferences", { cache: "no-store", signal });
            const current = await fresh.json();
            if ([401, 403].includes(fresh.status) || fresh.ok && current.scope !== initial.scope) { onRevoked(); throw new Error(); }
            if (!fresh.ok) throw new Error();
            version.current = current.version;
            continue;
          }
          if (!response.ok) throw new Error();
          version.current = body.version; saved.current = serialized;
          return;
        }
      } catch { if (!signal.aborted) setError(t("preferencesFailed")); }
      finally { if (!signal.aborted) setSaving(false); }
    });
    queue.current = operation;
    return operation;
  }, [initial.scope, onRevoked, t, fetchNotes]);
  const serialized = JSON.stringify(state);
  useEffect(() => {
    if (serialized === saved.current) return;
    const timer = window.setTimeout(() => { void save(); }, 500);
    return () => window.clearTimeout(timer);
  }, [serialized, save]);
  return { error, saving, retry: save };
}
