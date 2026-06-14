"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type AuditEntry = {
  id: string;
  action: string;
  resourceType: string | null;
  resourceName: string | null;
  allianceId: string | null;
  createdAt: string;
};

export default function AdminAuditPage() {
  const t = useTranslations("admin");
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/audit?limit=200")
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return res.json() as Promise<{ entries: AuditEntry[] }>;
      })
      .then((data) => setEntries(data.entries))
      .catch((err) =>
        setError(err instanceof Error ? err.message : t("loadFailed")),
      );
  }, [t]);

  if (error) {
    return <p className="text-sm text-red-400">{error}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-[#30363d]">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-[#161b22] text-[#8b949e]">
          <tr>
            <th className="px-4 py-2">{t("table.time")}</th>
            <th className="px-4 py-2">{t("table.action")}</th>
            <th className="px-4 py-2">{t("table.resource")}</th>
            <th className="px-4 py-2">{t("table.alliance")}</th>
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
              <td className="px-4 py-2 font-mono text-xs">{entry.allianceId ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
