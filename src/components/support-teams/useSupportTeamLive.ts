"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupportCommand, SupportSnapshot } from "@/lib/support-teams/types.shared";
import { acceptSnapshot, SupportClientError, supportRequest } from "@/lib/support-teams/board-client.shared";
import type { SupportDisplayPreferences } from "@/lib/support-teams/display-preferences.shared";

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
  const refresh = useCallback(async () => {
    try {
      const next = await supportRequest<SupportSnapshot>("/api/support-teams");
      if (!mounted.current || denied.current) return;
      current.current = acceptSnapshot(current.current, next);
      setSnapshot(current.current);
    } catch (error) {
      if (!mounted.current) return;
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
          if (event.type === "ready" || value.version > current.current.version) void refresh();
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
      await supportRequest("/api/support-teams", { method: "POST", body: JSON.stringify({ command, idempotencyKey }) });
      attempts.current.delete(intent);
      setNotice(true);
      await refresh();
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
