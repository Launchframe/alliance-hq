"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { SupportCommand, SupportSnapshot } from "@/lib/support-teams/types.shared";
import { acceptSnapshot, acceptsDraftSnapshot, draftWorkspaceKey, SupportClientError, supportRequest } from "@/lib/support-teams/board-client.shared";
import type { DraftSnapshot } from "@/lib/support-teams/draft.shared";
import type { SupportDisplayPreferences } from "@/lib/support-teams/display-preferences.shared";
import type { ProposalSnapshot } from "@/lib/support-teams/proposal.shared";
import { acceptsProposalSnapshot, proposalWorkspaceKey } from "@/lib/support-teams/board-client.shared";

export function useSupportTeamProposals(live: SupportSnapshot, refreshBoard: (minimumVersion?: number) => Promise<void>) {
  const scope = live.actor?.canRead && live.board && live.actor.allianceId === live.board.allianceId ? JSON.stringify([live.board.allianceId, live.actor.principalId]) : null;
  const [selection, setSelection] = useState<{ scope: string; id: string } | null>(null);
  const selected = selection?.scope === scope ? selection.id : null;
  const desired = useRef(selected);
  const query = useSearchParams().get("proposal");
  const observedQuery = useRef(query);
  const [loaded, setLoaded] = useState<{ key: string; snapshot: ProposalSnapshot } | null>(null);
  const [listing, setListing] = useState<{ scope: string; proposals: ProposalSnapshot[] } | null>(null);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const minimum = useRef<{ scope: string | null; version: number }>({ scope: null, version: 0 });
  const [floor, setFloor] = useState({ scope: null as string | null, version: 0 });
  const select = useCallback((id: string) => {
    if (!scope) return;
    request.current?.abort();
    desired.current = id;
    setSelection({ scope, id });
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("proposal", id); else url.searchParams.delete("proposal");
    window.history.replaceState(window.history.state, "", url);
  }, [scope]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!scope || query === observedQuery.current) return;
      observedQuery.current = query;
      const id = query ?? "";
      if (desired.current === id) return;
      request.current?.abort();
      desired.current = id;
      setSelection({ scope, id });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [query, scope]);
  const load = useCallback(async (minimumVersion = 0) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (!scope) { setLoaded(null); setListing(null); setError(""); return; }
    const id = selected === null ? new URL(window.location.href).searchParams.get("proposal") ?? (live.board?.construction?.kind === "proposal" ? live.board.construction.id : "") : desired.current ?? selected;
    if (selected === null) { desired.current = id; setSelection({ scope, id }); }
    const key = proposalWorkspaceKey(live, id);
    minimum.current = { scope, version: Math.max(minimum.current.scope === scope ? minimum.current.version : 0, live.version, minimumVersion) };
    setFloor(minimum.current);
    try {
      const [list, next] = await Promise.all([
        supportRequest<{ proposals: ProposalSnapshot[] }>("/api/support-teams/proposals", { signal: controller.signal }),
        id ? supportRequest<ProposalSnapshot>(`/api/support-teams/proposals/${encodeURIComponent(id)}`, { signal: controller.signal }) : Promise.resolve(null),
      ]);
      if (controller.signal.aborted) return;
      if (list.proposals.every((proposal) => proposal.version >= minimum.current.version)) setListing({ scope, proposals: list.proposals });
      if (next && key && acceptsProposalSnapshot(next, live, id, key) && next.version >= minimum.current.version) {
        minimum.current.version = next.version;
        setLoaded({ key, snapshot: next });
      }
      setError("");
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof SupportClientError && (failure.status === 401 || failure.status === 403)) { setLoaded(null); setListing(null); await refreshBoard(); }
      setError(failure instanceof SupportClientError ? failure.code : "changed");
    }
  }, [live, refreshBoard, scope, selected]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => { window.clearTimeout(timer); request.current?.abort(); }; }, [load]);
  const refresh = useCallback(async (minimumVersion = 0) => { await load(minimumVersion); await refreshBoard(minimumVersion); }, [load, refreshBoard]);
  const key = proposalWorkspaceKey(live, selected);
  const snapshot = key && loaded?.key === key ? loaded.snapshot : null;
  const current = snapshot && snapshot.version >= live.version && snapshot.version >= (floor.scope === scope ? floor.version : 0);
  return { selected, select, refresh, error, proposals: listing?.scope === scope ? listing.proposals : [], snapshot: snapshot && !current ? { ...snapshot, canEdit: false, canApprove: false, canPublish: false, canOverride: false, canCancel: false } : snapshot };
}

export function useSupportTeamDraft(live: SupportSnapshot, refreshBoard: (minimumVersion?: number) => Promise<void>) {
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
  const refresh = useCallback(async (minimumVersion = 0) => { await load(minimumVersion); await refreshBoard(minimumVersion); }, [load, refreshBoard]);
  return { snapshot: loaded?.key === key ? loaded.snapshot : null, active: key !== null, key, error, refresh };
}

export type DisplayState = { version: number; display: SupportDisplayPreferences };
export function useSupportTeamLive(initial: SupportSnapshot, initialPreferences: DisplayState) {
  const [snapshot, setSnapshot] = useState(initial);
  const [preferences, setPreferences] = useState(initialPreferences);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [notice, setNotice] = useState(false);
  const current = useRef(initial);
  const mounted = useRef(true);
  const mutation = useRef(false);
  const denied = useRef(false);
  const attempts = useRef(new Map<string, string>());
  const refreshRequest = useRef(0);
  const minimumVersion = useRef(initial.version);
  const refresh = useCallback(async (minimum = 0) => {
    minimumVersion.current = Math.max(minimumVersion.current, minimum);
    const generation = ++refreshRequest.current;
    try {
      const next = await supportRequest<SupportSnapshot>("/api/support-teams");
      if (!mounted.current || denied.current || generation !== refreshRequest.current) return;
      if (current.current.board && next.board && current.current.board.allianceId !== next.board.allianceId) {
        denied.current = true;
        current.current = { version: 0, published: false, teams: [], roster: [], linkedMemberIds: [], canWrite: false };
        setErrors({ connection: "forbidden" });
      } else if (next.version >= minimumVersion.current) current.current = acceptSnapshot(current.current, next);
      setSnapshot(current.current);
    } catch (error) {
      if (!mounted.current || generation !== refreshRequest.current) return;
      setConnected(false);
      if (error instanceof SupportClientError && (error.status === 401 || error.status === 403)) {
        denied.current = true;
        current.current = { version: current.current.version, published: false, teams: [], roster: [], linkedMemberIds: [], canWrite: false };
        setSnapshot(current.current);
      }
      setErrors((old) => ({ ...old, connection: error instanceof SupportClientError ? error.code : "changed" }));
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    let stream: EventSource | undefined;
    if (initial.actor?.canRead) {
      stream = new EventSource("/api/events/support-teams");
      const invalidate = (event: MessageEvent) => {
        try {
          const value = JSON.parse(event.data) as { allianceId: string; version: number };
          if (value.allianceId !== initial.board?.allianceId) return;
          setConnected(true);
          setErrors((old) => ({ ...old, connection: "" }));
          if (event.type === "ready" || value.version > current.current.version) void refresh(value.version);
        } catch { setConnected(false); }
      };
      stream.addEventListener("ready", invalidate);
      stream.addEventListener("invalidate", invalidate);
      stream.onerror = () => { setConnected(false); void refresh(); };
    }
    const check = () => {
      void refresh();
      void supportRequest<DisplayState>("/api/support-teams/preferences").then((next) => {
        if (mounted.current) setPreferences((old) => next.version >= old.version ? next : old);
      }).catch(() => undefined);
    };
    const timer = window.setInterval(check, 30_000);
    window.addEventListener("focus", check);
    void refresh();
    return () => { mounted.current = false; stream?.close(); clearInterval(timer); window.removeEventListener("focus", check); };
  }, [initial.actor?.canRead, initial.board?.allianceId, refresh]);
  const execute = useCallback(async (command: SupportCommand, slot: string) => {
    if (mutation.current) return false;
    mutation.current = true;
    setPending(slot);
    setNotice(false);
    setErrors((old) => ({ ...old, [slot]: "" }));
    const intent = JSON.stringify(command);
    const idempotencyKey = attempts.current.get(intent) ?? crypto.randomUUID();
    attempts.current.set(intent, idempotencyKey);
    try {
      const result = await supportRequest<{ version: number }>("/api/support-teams", { method: "POST", body: JSON.stringify({ command, idempotencyKey }) });
      attempts.current.delete(intent);
      setNotice(true);
      await refresh(result.version);
      return true;
    } catch (error) {
      if (error instanceof SupportClientError) attempts.current.delete(intent);
      setErrors((old) => ({ ...old, [slot]: error instanceof SupportClientError ? error.code : "changed" }));
      await refresh();
      return false;
    } finally { mutation.current = false; setPending(null); }
  }, [refresh]);
  const savePreferences = async (display: SupportDisplayPreferences) => {
    if (mutation.current) return;
    mutation.current = true;
    setPending("preferences");
    setErrors((old) => ({ ...old, preferences: "" }));
    try {
      const next = await supportRequest<DisplayState>("/api/support-teams/preferences", { method: "PUT", body: JSON.stringify({ expectedVersion: preferences.version, display }) });
      setPreferences(next);
    } catch (error) {
      setErrors((old) => ({ ...old, preferences: error instanceof SupportClientError ? error.code : "changed" }));
      const next = await supportRequest<DisplayState>("/api/support-teams/preferences").catch(() => null);
      if (next) setPreferences(next);
    } finally { mutation.current = false; setPending(null); }
  };
  return { snapshot, preferences, errors, pending, connected, notice, execute, refresh, savePreferences };
}
