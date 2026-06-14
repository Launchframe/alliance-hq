"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import {
  AUDIT_ACTION_FILTER_OPTIONS,
  buildAuditLogSearchParams,
  type AuditLogFilters,
} from "@/lib/admin/audit-query";

type Alliance = {
  id: string;
  name: string;
  slug: string;
  tag: string | null;
  ashedAllianceId: string | null;
};

type AuditEntry = {
  id: string;
  action: string;
  resourceType: string | null;
  resourceName: string | null;
  allianceId: string | null;
  hqUserId: string | null;
  createdAt: string;
};

const DEFAULT_FILTERS: AuditLogFilters = {
  limit: 200,
};

function allianceTagLabel(alliance: Alliance): string {
  return alliance.tag?.trim() || alliance.slug;
}

function buildAllianceTagLookup(alliances: Alliance[]): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const alliance of alliances) {
    const label = allianceTagLabel(alliance);
    lookup.set(alliance.id, label);
    if (alliance.ashedAllianceId) {
      lookup.set(alliance.ashedAllianceId, label);
    }
  }
  return lookup;
}

function dateInputToIsoStart(date: string): Date | undefined {
  if (!date) return undefined;
  return new Date(`${date}T00:00:00.000Z`);
}

function dateInputToIsoEnd(date: string): Date | undefined {
  if (!date) return undefined;
  return new Date(`${date}T23:59:59.999Z`);
}

export function AdminAuditConsole() {
  const t = useTranslations("admin");
  const tAudit = useTranslations("admin.auditPage");
  const [alliances, setAlliances] = useState<Alliance[]>([]);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [filters, setFilters] = useState<AuditLogFilters>(DEFAULT_FILTERS);
  const [sinceDate, setSinceDate] = useState("");
  const [untilDate, setUntilDate] = useState("");
  const [hqUserIdInput, setHqUserIdInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const allianceTagLookup = useMemo(
    () => buildAllianceTagLookup(alliances),
    [alliances],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const qs = buildAuditLogSearchParams(filters);
        const res = await fetch(`/api/admin/audit?${qs}`);
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          throw new Error(data.error ?? tAudit("loadFailed"));
        }
        const data = (await res.json()) as { entries: AuditEntry[] };
        if (!cancelled) {
          setEntries(data.entries);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : tAudit("loadFailed"));
          setEntries([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filters, tAudit]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/admin/alliances");
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as { alliances: Alliance[] };
        setAlliances(data.alliances);
      } catch {
        // Alliance dropdown optional — audit still loads without it
      }
    })();
  }, []);

  function applyDateAndUserFilters() {
    setFilters((prev) => ({
      ...prev,
      since: dateInputToIsoStart(sinceDate),
      until: dateInputToIsoEnd(untilDate),
      hqUserId: hqUserIdInput.trim() || undefined,
    }));
  }

  function clearFilters() {
    setSinceDate("");
    setUntilDate("");
    setHqUserIdInput("");
    setFilters(DEFAULT_FILTERS);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[#30363d] bg-[#161b22] p-4">
        <label className="space-y-1 text-sm">
          <span className="text-[#8b949e]">{tAudit("filters.alliance")}</span>
          <select
            className="block min-w-[12rem] rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 font-mono text-sm"
            value={filters.allianceId ?? ""}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                allianceId: e.target.value || undefined,
              }))
            }
          >
            <option value="">{tAudit("filters.allAlliances")}</option>
            {alliances.map((alliance) => (
              <option key={alliance.id} value={alliance.id}>
                {allianceTagLabel(alliance)}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-[#8b949e]">{tAudit("filters.action")}</span>
          <select
            className="block min-w-[12rem] rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm"
            value={filters.action ?? ""}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                action: e.target.value || undefined,
              }))
            }
          >
            {AUDIT_ACTION_FILTER_OPTIONS.map((option) => (
              <option key={option.value || "all"} value={option.value}>
                {tAudit(`filters.actions.${option.labelKey}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-[#8b949e]">{tAudit("filters.since")}</span>
          <input
            type="date"
            className="block rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm"
            value={sinceDate}
            onChange={(e) => setSinceDate(e.target.value)}
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-[#8b949e]">{tAudit("filters.until")}</span>
          <input
            type="date"
            className="block rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm"
            value={untilDate}
            onChange={(e) => setUntilDate(e.target.value)}
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-[#8b949e]">{tAudit("filters.hqUserId")}</span>
          <input
            type="text"
            className="block min-w-[10rem] rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 font-mono text-xs"
            value={hqUserIdInput}
            placeholder={tAudit("filters.hqUserIdPlaceholder")}
            onChange={(e) => setHqUserIdInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyDateAndUserFilters();
            }}
          />
        </label>

        <button
          type="button"
          className="rounded-lg bg-[#238636] px-3 py-2 text-sm text-white hover:bg-[#2ea043]"
          onClick={applyDateAndUserFilters}
        >
          {tAudit("filters.apply")}
        </button>

        <button
          type="button"
          className="rounded-lg border border-[#30363d] px-3 py-2 text-sm text-[#8b949e] hover:bg-[#21262d]"
          onClick={clearFilters}
        >
          {tAudit("filters.clear")}
        </button>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      {loading ? (
        <p className="text-sm text-[#8b949e]">{tAudit("loading")}</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-[#8b949e]">{tAudit("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#30363d]">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[#161b22] text-[#8b949e]">
              <tr>
                <th className="px-4 py-2">{t("table.time")}</th>
                <th className="px-4 py-2">{t("table.action")}</th>
                <th className="px-4 py-2">{t("table.resource")}</th>
                <th className="px-4 py-2">{tAudit("table.allianceTag")}</th>
                <th className="px-4 py-2">{tAudit("table.hqUser")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-t border-[#30363d]">
                  <td className="px-4 py-2 whitespace-nowrap text-[#8b949e]">
                    {new Date(entry.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2">{entry.action}</td>
                  <td className="px-4 py-2">
                    {entry.resourceType}/{entry.resourceName}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {entry.allianceId
                      ? (allianceTagLookup.get(entry.allianceId) ??
                        entry.allianceId)
                      : "—"}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {entry.hqUserId ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
