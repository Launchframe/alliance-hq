"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { intakeResultIsCurrent, type IntakePreference, type IntakeResult } from "@/lib/notes/intake.shared";

export function useNoteIntake({ draftId, body, revision, overrideRevision, active, onResult }: { draftId: string; body: string; revision: number; overrideRevision: number; active: boolean; onResult: (result: IntakeResult) => void }) {
  const locale = useLocale();
  const t = useTranslations("notes");
  const [preference, setPreference] = useState<IntakePreference | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [pendingEnabled, setPendingEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/notes/intake/preferences", { cache: "no-store", signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? t("loadFailed"));
        if (!controller.signal.aborted) setPreference(payload);
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : t("loadFailed")); }
    })();
    return () => controller.abort();
  }, [t]);
  useEffect(() => {
    if (!active || !preference?.enabled || !preference.configured || !body.trim() || body.length > 10_000) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPending(true); setError(null);
      try {
        for (let attempt = 0; attempt < 30 && !controller.signal.aborted; attempt++) {
          const response = await fetch("/api/notes/intake/interpret", {
            method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
            body: JSON.stringify({ draftId, body, revision, overrideRevision, locale }),
          });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error ?? t("intake.failed"));
          if (controller.signal.aborted) return;
          if (payload.state === "complete") {
            if (intakeResultIsCurrent(payload.result, { draftId, revision, overrideRevision, scope: preference.scope }) && payload.result.preferenceVersion === preference.version) onResult(payload.result);
            return;
          }
          await new Promise<void>((resolve) => {
            const finish = () => { window.clearTimeout(wait); controller.signal.removeEventListener("abort", finish); resolve(); };
            const wait = window.setTimeout(finish, 750);
            controller.signal.addEventListener("abort", finish, { once: true });
          });
        }
        if (!controller.signal.aborted) throw new Error(t("intake.failed"));
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : t("intake.failed")); }
      finally { if (!controller.signal.aborted) setPending(false); }
    }, 650);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [active, body, draftId, revision, overrideRevision, onResult, locale, preference, t]);
  async function setEnabled(enabled: boolean) {
    if (!preference || changing) return;
    setChanging(true); setPendingEnabled(enabled); setError(null);
    try {
      const response = await fetch("/api/notes/intake/preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled, expectedVersion: preference.version }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? t("intake.failed"));
      setPreference(payload);
    } catch (failure) { setError(failure instanceof Error ? failure.message : t("intake.failed")); }
    finally { setChanging(false); setPendingEnabled(null); }
  }
  return { preference, enabled: pendingEnabled ?? preference?.enabled ?? false, pending: pending && active && !!body.trim() && body.length <= 10_000 && preference?.enabled === true, changing, error, setEnabled };
}
