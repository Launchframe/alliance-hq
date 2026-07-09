"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import type {
  OfficerActivityEvent,
  OfficerUnassignedEngRow,
  OfficerWlRow,
} from "@/lib/professions/types";

type PortalData = {
  minEngsPerTeam: number;
  totalWls: number;
  coveredWls: number;
  wlRows: OfficerWlRow[];
  unassignedEngs: OfficerUnassignedEngRow[];
  recentEvents: OfficerActivityEvent[];
};

type Props = {
  data: PortalData;
  allianceId: string;
};

function eventLabel(e: OfficerActivityEvent): string {
  const actor = e.actorName ?? e.actorCommanderId ?? "Unknown";
  const subject = e.subjectName ?? e.subjectCommanderId;
  switch (e.eventKind) {
    case "eng_assigned":
      return `${actor} joined ${subject ?? "a WL"}'s team`;
    case "eng_dismissed":
      return `${subject ?? "An Eng"} was dismissed by ${actor}`;
    case "eng_self_removed":
      return `${actor} left ${subject ?? "a WL"}'s team`;
    case "more_engs_requested":
      return `${actor} requested more Engineers`;
    case "profession_switched": {
      const d = e.details as { from?: string; to?: string } | null;
      return `${actor} switched: ${d?.from ?? "?"} → ${d?.to ?? "?"}`;
    }
    default:
      return `${actor} — ${e.eventKind}`;
  }
}

function InviteMessage({ wlName }: { wlName: string | null }) {
  const msg = `Hey! Your War Leader${wlName ? ` ${wlName}` : ""} needs Engineer support on Alliance HQ. Visit frontline.gay and go to Profession Hub to get assigned.`;
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(msg);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  return (
    <Button variant="ghost" size="sm" onClick={copy}>
      {copied ? "Copied!" : "Copy invite"}
    </Button>
  );
}

function EngInviteMessage({ engName }: { engName: string | null }) {
  const msg = `Hey${engName ? ` ${engName}` : ""}! You haven't been assigned to a War Leader team yet. Visit frontline.gay → Profession Hub to join one.`;
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(msg);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  return (
    <Button variant="ghost" size="sm" onClick={copy}>
      {copied ? "Copied!" : "Copy invite"}
    </Button>
  );
}

export function OfficerPortal({ data, allianceId }: Props) {
  const [minEngs, setMinEngs] = useState(String(data.minEngsPerTeam));
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const uncoveredWls = data.wlRows.filter((r) => !r.isCovered);

  async function saveSettings() {
    setSavingSettings(true);
    setSettingsSaved(false);
    setSettingsError(null);
    try {
      const res = await fetch("/api/settings/professions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wlMinEngsPerTeam: Number(minEngs) }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        setSettingsError(json.error ?? "Save failed.");
      } else {
        setSettingsSaved(true);
      }
    } finally {
      setSavingSettings(false);
    }
  }

  return (
    <div className="p-6 space-y-8 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold text-hq-fg">Profession Portal</h1>
        <p className="text-sm text-hq-fg-muted">
          Alliance-wide War Leader coverage and Engineer assignments.
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "War Leaders", value: data.totalWls },
          { label: "Covered", value: data.coveredWls, good: data.coveredWls === data.totalWls },
          { label: "Need attention", value: uncoveredWls.length, bad: uncoveredWls.length > 0 },
          { label: "Unassigned Engs", value: data.unassignedEngs.length, bad: data.unassignedEngs.length > 0 },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-lg border border-hq-border p-4 space-y-1"
          >
            <p
              className={`text-2xl font-bold ${
                stat.bad ? "text-hq-warning" : stat.good ? "text-hq-success" : "text-hq-fg"
              }`}
            >
              {stat.value}
            </p>
            <p className="text-xs text-hq-fg-muted">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* WL coverage table */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-hq-fg">War Leader Coverage</h2>
        <div className="border border-hq-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hq-border bg-hq-surface-muted">
                <th className="text-left px-4 py-2 text-xs font-medium text-hq-fg-muted">War Leader</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-hq-fg-muted">Engineers</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-hq-fg-muted">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-hq-border">
              {data.wlRows.map((row) => (
                <tr key={row.wlCommanderId} className="hover:bg-hq-surface-muted/40">
                  <td className="px-4 py-2.5 font-medium text-hq-fg">
                    {row.wlName ?? row.wlCommanderId}
                  </td>
                  <td className="px-4 py-2.5 text-hq-fg-muted">
                    {row.activeEngCount} / {row.minEngsPerTeam}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        row.isCovered
                          ? "bg-hq-success/15 text-hq-success"
                          : "bg-hq-warning/15 text-hq-warning"
                      }`}
                    >
                      {row.isCovered ? "Covered" : "Needs support"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {!row.isCovered && <InviteMessage wlName={row.wlName} />}
                  </td>
                </tr>
              ))}
              {data.wlRows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-sm text-hq-fg-muted">
                    No War Leaders found in your alliance roster.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Unassigned Engineers */}
      {data.unassignedEngs.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-hq-fg">
            Unassigned Engineers ({data.unassignedEngs.length})
          </h2>
          <div className="border border-hq-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hq-border bg-hq-surface-muted">
                  <th className="text-left px-4 py-2 text-xs font-medium text-hq-fg-muted">Engineer</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-hq-border">
                {data.unassignedEngs.map((eng) => (
                  <tr key={eng.engCommanderId} className="hover:bg-hq-surface-muted/40">
                    <td className="px-4 py-2.5 font-medium text-hq-fg">
                      {eng.engName ?? eng.engCommanderId}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <EngInviteMessage engName={eng.engName} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Activity feed */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-hq-fg">Activity Feed</h2>
        {data.recentEvents.length === 0 ? (
          <p className="text-sm text-hq-fg-muted">No recent activity.</p>
        ) : (
          <ul className="divide-y divide-hq-border border border-hq-border rounded-lg overflow-hidden">
            {data.recentEvents.map((evt) => (
              <li key={evt.id} className="flex items-center justify-between px-4 py-2.5">
                <p className="text-sm text-hq-fg">{eventLabel(evt)}</p>
                <p className="text-xs text-hq-fg-muted shrink-0 ml-4">
                  {new Date(evt.createdAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Settings */}
      <section className="space-y-3 border-t border-hq-border pt-6">
        <h2 className="text-sm font-semibold text-hq-fg">Profession Settings</h2>
        <div className="flex items-center gap-4">
          <label className="text-sm text-hq-fg-muted">
            Minimum Engineers per War Leader
          </label>
          <input
            type="number"
            min={1}
            max={10}
            value={minEngs}
            onChange={(e) => setMinEngs(e.target.value)}
            className="w-16 rounded border border-hq-border bg-hq-surface px-2 py-1 text-sm text-hq-fg"
          />
          <Button size="sm" onClick={saveSettings} disabled={savingSettings}>
            {savingSettings ? "Saving…" : "Save"}
          </Button>
          {settingsSaved && (
            <span className="text-xs text-hq-success">Saved</span>
          )}
          {settingsError && (
            <span className="text-xs text-hq-danger">{settingsError}</span>
          )}
        </div>
      </section>
    </div>
  );
}
