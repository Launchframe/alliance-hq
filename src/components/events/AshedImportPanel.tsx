"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Link } from "@/i18n/navigation";
import type { EventTarget } from "@/lib/hq-events/event-types.shared";

/** Ashed score entity per family (server validates each row regardless). */
const SUBMIT_ENTITY: Record<EventTarget, string> = {
  "warzone-duel": "SeasonalEventScore",
  "frontline-breakthrough": "SeasonalScore",
  seasonal: "SeasonalScore",
  "desert-storm": "DesertStormScore",
  "canyon-storm": "CanyonStormScore",
};

type Props = {
  eventId: string;
  target: EventTarget | null;
  ashedEventId: string | null;
  /** `hq:events:write` — allows the link step. */
  canLink: boolean;
  /** `scores:write` — allows committing imported evidence. */
  canImport: boolean;
  onChanged: () => void;
};

export function AshedImportPanel({
  eventId,
  target,
  ashedEventId,
  canLink,
  canImport,
  onChanged,
}: Props) {
  const t = useTranslations("eventEvidence");
  const tAdmin = useTranslations("admin.hqEventsPage");
  const tActions = useTranslations("vsPerformance.actions");
  const tSettings = useTranslations("settings");

  const [remoteEventId, setRemoteEventId] = useState(ashedEventId ?? "");
  const [pending, setPending] = useState<"link" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notConnected, setNotConnected] = useState(false);
  const [confirmLegacy, setConfirmLegacy] = useState<null | {
    requestId: string;
  }>(null);

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/hq-events/${eventId}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const code = typeof json?.error === "string" ? json.error : "failed";
      if (code === "ashed_not_connected" || code === "alliance_not_ashed_linked") {
        setNotConnected(true);
      }
      throw new Error(code);
    }
    return json;
  };

  const link = async () => {
    setPending("link");
    setError(null);
    try {
      await post({ action: "link", remoteEventId: remoteEventId.trim() });
      onChanged();
    } catch {
      setError(t("actionFailed"));
    } finally {
      setPending(null);
    }
  };

  const runImport = async (
    classification: "unconfirmed" | "real" | "legacy",
  ) => {
    const requestId = crypto.randomUUID();
    setPending("import");
    setError(null);
    try {
      const result = await post({
        action: "import",
        remoteEventId: remoteEventId.trim(),
        requestId,
        submitEntity: SUBMIT_ENTITY[target ?? "seasonal"],
        classification,
      });
      // Staged (unconfirmed) rows stay unclassified until the officer
      // confirms the legacy mapping or real scores.
      if (classification === "unconfirmed" && result?.staged) {
        setConfirmLegacy({ requestId });
      }
      onChanged();
    } catch {
      setError(t("actionFailed"));
    } finally {
      setPending(null);
    }
  };

  if (notConnected) {
    return (
      <section className="rounded-lg border border-hq-border bg-hq-surface p-4">
        <Link
          href="/settings"
          className="text-sm font-medium text-hq-accent hover:underline"
        >
          {tSettings("connectAshedCta")}
        </Link>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-lg border border-hq-border bg-hq-surface p-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-40 flex-1 space-y-1">
          <label
            className="text-xs text-hq-fg-muted"
            htmlFor="ashed-remote-event-id"
          >
            {tAdmin("eventId")}
          </label>
          <input
            id="ashed-remote-event-id"
            type="text"
            value={remoteEventId}
            onChange={(e) => setRemoteEventId(e.target.value)}
            className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
          />
        </div>
        {canLink && !ashedEventId ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending != null || !remoteEventId.trim()}
            onClick={() => void link()}
          >
            {t("importFromAshed")}
          </Button>
        ) : null}
        {canImport ? (
          <Button
            type="button"
            size="sm"
            disabled={pending != null || !remoteEventId.trim()}
            onClick={() => void runImport("unconfirmed")}
          >
            {t("importFromAshed")}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-hq-danger">
          {error}
        </p>
      ) : null}
      <Dialog
        open={confirmLegacy != null}
        onOpenChange={(open) => !open && setConfirmLegacy(null)}
        title={t("confirmLegacyMapping")}
      >
        <div className="space-y-4 p-1">
          <p className="text-sm text-hq-fg-muted">{t("legacyMappingHint")}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending != null}
              onClick={() => setConfirmLegacy(null)}
            >
              {tActions("cancel")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending != null}
              onClick={() => {
                setConfirmLegacy(null);
                void runImport("real");
              }}
            >
              {t("actualScoresImport")}
            </Button>
            <Button
              type="button"
              disabled={pending != null}
              onClick={() => {
                setConfirmLegacy(null);
                void runImport("legacy");
              }}
            >
              {t("confirmLegacyMapping")}
            </Button>
          </div>
        </div>
      </Dialog>
    </section>
  );
}
