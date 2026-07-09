"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { EngCountBadge } from "@/components/professions/EngCountBadge";
import { Button } from "@/components/ui/button";
import type {
  OfficerActivityEvent,
  OfficerUnassignedEngRow,
  OfficerWlRow,
  Profession,
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
  onRefresh: () => void;
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
  const t = useTranslations("professions");
  const msg = t("inviteWlMessage", { name: wlName ?? "" });
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
    <Button variant="ghost" size="sm" onClick={() => void copy()}>
      {copied ? t("copied") : t("inviteCopy")}
    </Button>
  );
}

function EngInviteMessage({ engName }: { engName: string | null }) {
  const t = useTranslations("professions");
  const msg = t("inviteEngMessage", { name: engName ?? "" });
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
    <Button variant="ghost" size="sm" onClick={() => void copy()}>
      {copied ? t("copied") : t("inviteCopy")}
    </Button>
  );
}

function AssignEngControl({
  eng,
  wlRows,
  onAssigned,
}: {
  eng: OfficerUnassignedEngRow;
  wlRows: OfficerWlRow[];
  onAssigned: () => void;
}) {
  const t = useTranslations("professions");
  const [wlId, setWlId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function assign() {
    if (!wlId) return;
    setAssigning(true);
    setError(null);
    try {
      const res = await fetch("/api/professions/officer/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engCommanderId: eng.engCommanderId,
          wlCommanderId: wlId,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? t("assignFailed"));
      } else {
        onAssigned();
      }
    } finally {
      setAssigning(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <select
          value={wlId}
          onChange={(e) => setWlId(e.target.value)}
          className="rounded border border-hq-border bg-hq-surface px-2 py-1 text-xs text-hq-fg"
        >
          <option value="">{t("selectWl")}</option>
          {wlRows.map((wl) => (
            <option key={wl.wlCommanderId} value={wl.wlCommanderId}>
              {wl.wlName ?? wl.wlCommanderId}
            </option>
          ))}
        </select>
        <Button size="sm" variant="outline" disabled={!wlId || assigning} onClick={() => void assign()}>
          {assigning ? t("assigning") : t("officerAssign")}
        </Button>
      </div>
      {error ? <p className="text-xs text-hq-danger">{error}</p> : null}
    </div>
  );
}

function SetProfessionControl({
  commanderId,
  currentProfession,
  onUpdated,
}: {
  commanderId: string;
  currentProfession: string | null;
  onUpdated: () => void;
}) {
  const t = useTranslations("professions");
  const [toProfession, setToProfession] = useState<Profession | "">("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!toProfession) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/professions/officer/set-profession", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commanderId, toProfession }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? t("setProfessionFailed"));
      } else {
        onUpdated();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <span className="text-xs text-hq-fg-muted">{currentProfession ?? "—"}</span>
        <select
          value={toProfession}
          onChange={(e) => setToProfession(e.target.value as Profession | "")}
          className="rounded border border-hq-border bg-hq-surface px-2 py-1 text-xs text-hq-fg"
        >
          <option value="">{t("setProfession")}</option>
          <option value="Engineer">{t("eng")}</option>
          <option value="War Leader">{t("wl")}</option>
        </select>
        <Button size="sm" variant="ghost" disabled={!toProfession || saving} onClick={() => void save()}>
          {saving ? t("saving") : t("save")}
        </Button>
      </div>
      {error ? <p className="text-xs text-hq-danger">{error}</p> : null}
    </div>
  );
}

export function OfficerPortal({ data, onRefresh }: Props) {
  const t = useTranslations("professions");
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
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setSettingsError(json.error ?? t("saveSettingsFailed"));
      } else {
        setSettingsSaved(true);
        onRefresh();
      }
    } finally {
      setSavingSettings(false);
    }
  }

  return (
    <div className="max-w-4xl space-y-8">
      <p className="text-sm text-hq-fg-muted">{t("officerDesc")}</p>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: t("totalWLs"), value: data.totalWls },
          {
            label: t("coveredWLs"),
            value: data.coveredWls,
            good: data.coveredWls === data.totalWls,
          },
          {
            label: t("needAttention"),
            value: uncoveredWls.length,
            bad: uncoveredWls.length > 0,
          },
          {
            label: t("unassignedEngs"),
            value: data.unassignedEngs.length,
            bad: data.unassignedEngs.length > 0,
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="space-y-1 rounded-lg border border-hq-border p-4"
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

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-hq-fg">{t("wlTableTitle")}</h2>
        <div className="overflow-hidden rounded-lg border border-hq-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hq-border bg-hq-surface-muted">
                <th className="px-4 py-2 text-left text-xs font-medium text-hq-fg-muted">
                  {t("wl")}
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-hq-fg-muted">
                  {t("eng")}
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-hq-fg-muted">
                  {t("status")}
                </th>
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
                    <EngCountBadge
                      activeCount={row.activeEngCount}
                      minCount={row.minEngsPerTeam}
                      engNames={row.assignedEngNames}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        row.isCovered
                          ? "bg-hq-success/15 text-hq-success"
                          : "bg-hq-warning/15 text-hq-warning"
                      }`}
                    >
                      {row.isCovered ? t("covered") : t("needsSupport")}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {!row.isCovered ? <InviteMessage wlName={row.wlName} /> : null}
                  </td>
                </tr>
              ))}
              {data.wlRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-sm text-hq-fg-muted">
                    {t("noWlsInRoster")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {data.unassignedEngs.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-hq-fg">
            {t("engTableTitle")} ({data.unassignedEngs.length})
          </h2>
          <div className="overflow-hidden rounded-lg border border-hq-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hq-border bg-hq-surface-muted">
                  <th className="px-4 py-2 text-left text-xs font-medium text-hq-fg-muted">
                    {t("eng")}
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-hq-fg-muted">
                    {t("actions")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hq-border">
                {data.unassignedEngs.map((eng) => (
                  <tr key={eng.engCommanderId} className="hover:bg-hq-surface-muted/40">
                    <td className="px-4 py-2.5 font-medium text-hq-fg">
                      {eng.engName ?? eng.engCommanderId}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-col items-end gap-2">
                        <AssignEngControl
                          eng={eng}
                          wlRows={data.wlRows}
                          onAssigned={onRefresh}
                        />
                        <SetProfessionControl
                          commanderId={eng.engCommanderId}
                          currentProfession={eng.profession}
                          onUpdated={onRefresh}
                        />
                        <EngInviteMessage engName={eng.engName} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-hq-fg">{t("activityFeed")}</h2>
        {data.recentEvents.length === 0 ? (
          <p className="text-sm text-hq-fg-muted">{t("noActivity")}</p>
        ) : (
          <ul className="divide-y divide-hq-border overflow-hidden rounded-lg border border-hq-border">
            {data.recentEvents.map((evt) => (
              <li
                key={evt.id}
                className="flex items-center justify-between px-4 py-2.5"
              >
                <p className="text-sm text-hq-fg">{eventLabel(evt)}</p>
                <p className="ml-4 shrink-0 text-xs text-hq-fg-muted">
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

      <section className="space-y-3 border-t border-hq-border pt-6">
        <h2 className="text-sm font-semibold text-hq-fg">{t("settingsTitle")}</h2>
        <div className="flex items-center gap-4">
          <label className="text-sm text-hq-fg-muted">{t("minEngsPerTeam")}</label>
          <input
            type="number"
            min={1}
            max={10}
            value={minEngs}
            onChange={(e) => setMinEngs(e.target.value)}
            className="w-16 rounded border border-hq-border bg-hq-surface px-2 py-1 text-sm text-hq-fg"
          />
          <Button size="sm" onClick={() => void saveSettings()} disabled={savingSettings}>
            {savingSettings ? t("saving") : t("saveSettings")}
          </Button>
          {settingsSaved ? (
            <span className="text-xs text-hq-success">{t("saved")}</span>
          ) : null}
          {settingsError ? (
            <span className="text-xs text-hq-danger">{settingsError}</span>
          ) : null}
        </div>
      </section>
    </div>
  );
}
