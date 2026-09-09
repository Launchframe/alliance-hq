"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVersionedSnapshot } from "@/components/member-board/useVersionedSnapshot";
import { supportLiveTransport } from "@/lib/support-teams/live-transport.shared";
import type { SupportCommand, SupportSnapshot } from "@/lib/support-teams/types.shared";
import { acceptsDraftSnapshot, draftWorkspaceKey, SupportClientError, supportRequest } from "@/lib/support-teams/board-client.shared";
import type { DraftSnapshot } from "@/lib/support-teams/draft.shared";
import type { SupportDisplayPreferences } from "@/lib/support-teams/display-preferences.shared";

export function useSupportTeamDraft(live: SupportSnapshot, refreshBoard: () => Promise<void>) {
  const key = draftWorkspaceKey(live);
  const [loaded, setLoaded] = useState<{ key: string; snapshot: DraftSnapshot } | null>(null);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const minimum = useRef<{ key: string | null; version: number }>({ key: null, version: 0 });
  const load = useCallback(async (minimumVersion = 0) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (!key) { setLoaded(null); setError(""); return; }
    minimum.current = { key, version: Math.max(minimum.current.key === key ? minimum.current.version : 0, live.version, minimumVersion) };
    try {
      const next = await supportRequest<DraftSnapshot>(`/api/support-teams/drafts/${encodeURIComponent(live.board!.construction!.id)}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (acceptsDraftSnapshot(next, live, key) && next.version >= minimum.current.version) {
        minimum.current.version = next.version;
        setLoaded({ key, snapshot: next });
        setError("");
      } else if (next.phase === "published" || next.phase === "canceled") {
        setLoaded(null);
        await refreshBoard();
      }
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof SupportClientError && (failure.status === 401 || failure.status === 403)) { setLoaded(null); await refreshBoard(); }
      setError(failure instanceof SupportClientError ? failure.code : "changed");
    }
  }, [key, live, refreshBoard]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => { window.clearTimeout(timer); request.current?.abort(); }; }, [load]);
  const refresh = useCallback(async (minimumVersion = 0) => { await load(minimumVersion); await refreshBoard(); }, [load, refreshBoard]);
  return { snapshot: loaded?.key === key ? loaded.snapshot : null, active: key !== null, key, error, refresh };
}

export type DisplayState = { version: number; display: SupportDisplayPreferences };
export function useSupportTeamLive(initial: SupportSnapshot, initialPreferences: DisplayState) {
  const allianceId = initial.board?.allianceId;
  const principalId = initial.actor?.principalId;
  const canRead = !!initial.actor?.canRead;
  const scope = allianceId ?? "support-teams";
  const identity = principalId ?? JSON.stringify(initial.linkedMemberIds);
  const transport = useMemo(() => supportLiveTransport(allianceId, principalId, canRead), [allianceId, principalId, canRead]);
  const live = useVersionedSnapshot({ scope, identity, initial, transport });
  const { refresh: refreshVersioned } = live;
  const refresh = useCallback(() => refreshVersioned(), [refreshVersioned]);
  const lifetime = useMemo(() => ({ key: JSON.stringify([scope, identity]), active: false, mutation: false, attempts: new Map<string, string>() }), [scope, identity]);
  const [state, setState] = useState(() => ({ key: lifetime.key, preferences: initialPreferences, errors: {} as Record<string, string>, pending: null as string | null, notice: false }));
  if (state.key !== lifetime.key) setState({ key: lifetime.key, preferences: initialPreferences, errors: {}, pending: null, notice: false });
  const update = useCallback((change: (old: typeof state) => typeof state) => { if (lifetime.active) setState((old) => old.key === lifetime.key ? change(old) : old); }, [lifetime]);
  useEffect(() => {
    lifetime.active = !live.revoked;
    if (live.revoked) return;
    let request: AbortController | undefined;
    const check = () => {
      request?.abort();
      const controller = new AbortController();
      request = controller;
      void supportRequest<DisplayState>("/api/support-teams/preferences", { signal: controller.signal }).then((next) => {
        if (!controller.signal.aborted) update((old) => next.version >= old.preferences.version ? { ...old, preferences: next } : old);
      }).catch(() => undefined);
    };
    const timer = window.setInterval(check, 30_000);
    window.addEventListener("focus", check);
    return () => { lifetime.active = false; request?.abort(); window.clearInterval(timer); window.removeEventListener("focus", check); };
  }, [lifetime, live.revoked, update]);
  const execute = useCallback(async (command: SupportCommand, slot: string) => {
    if (lifetime.mutation || !lifetime.active) return false;
    lifetime.mutation = true;
    update((old) => ({ ...old, pending: slot, notice: false, errors: { ...old.errors, [slot]: "" } }));
    const intent = JSON.stringify(command);
    const idempotencyKey = lifetime.attempts.get(intent) ?? crypto.randomUUID();
    lifetime.attempts.set(intent, idempotencyKey);
    try {
      await supportRequest("/api/support-teams", { method: "POST", body: JSON.stringify({ command, idempotencyKey }) });
      lifetime.attempts.delete(intent);
      if (!lifetime.active) return false;
      update((old) => ({ ...old, notice: true }));
      await refresh();
      return true;
    } catch (error) {
      if (error instanceof SupportClientError) lifetime.attempts.delete(intent);
      update((old) => ({ ...old, errors: { ...old.errors, [slot]: error instanceof SupportClientError ? error.code : "changed" } }));
      if (lifetime.active) await refresh();
      return false;
    } finally { lifetime.mutation = false; update((old) => ({ ...old, pending: null })); }
  }, [lifetime, refresh, update]);
  const savePreferences = async (display: SupportDisplayPreferences) => {
    if (lifetime.mutation || !lifetime.active) return;
    lifetime.mutation = true;
    update((old) => ({ ...old, pending: "preferences", errors: { ...old.errors, preferences: "" } }));
    try {
      const next = await supportRequest<DisplayState>("/api/support-teams/preferences", { method: "PUT", body: JSON.stringify({ expectedVersion: state.preferences.version, display }) });
      update((old) => next.version >= old.preferences.version ? { ...old, preferences: next } : old);
    } catch (error) {
      update((old) => ({ ...old, errors: { ...old.errors, preferences: error instanceof SupportClientError ? error.code : "changed" } }));
      if (!lifetime.active) return;
      const next = await supportRequest<DisplayState>("/api/support-teams/preferences").catch(() => null);
      if (next) update((old) => next.version >= old.preferences.version ? { ...old, preferences: next } : old);
    } finally { lifetime.mutation = false; update((old) => ({ ...old, pending: null })); }
  };
  const snapshot = live.snapshot ?? { version: 0, published: false, teams: [], roster: [], linkedMemberIds: [], canWrite: false };
  const connection = live.revoked ? "forbidden" : live.error instanceof SupportClientError ? live.error.code : live.error ? "changed" : "";
  const errors: Record<string, string> = { ...state.errors, connection };
  return { snapshot, preferences: state.preferences, errors, pending: live.revoked ? null : state.pending, connected: live.connected, notice: !live.revoked && state.notice, execute, refresh, savePreferences };
}
