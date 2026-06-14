"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Report = {
  id: string;
  locale: string;
  i18nKey: string | null;
  displayedText: string;
  suggestedTranslation: string;
  pagePath: string | null;
  status: string;
  hqUserId: string;
  createdAt: string;
  adminNotes: string | null;
};

export default function AdminTranslationReportsPage() {
  const t = useTranslations("adminTranslationReports");
  const [reports, setReports] = useState<Report[]>([]);
  const [filter, setFilter] = useState<string>("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selected = reports.find((r) => r.id === selectedId) ?? null;

  async function load(status?: string) {
    const query = status && status !== "all" ? `?status=${status}` : "";
    const res = await fetch(`/api/admin/translation-reports${query}`);
    if (!res.ok) throw new Error(await res.text());
    const data = (await res.json()) as { reports: Report[] };
    setReports(data.reports);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await load(filter);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t("loadFailed"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filter, t]);

  async function updateStatus(status: "applied" | "dismissed") {
    if (!selected) return;
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/translation-reports/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, adminNotes: notes || undefined }),
      });
      const data = (await res.json()) as {
        error?: string;
        commendations?: { awarded?: string[] };
      };
      if (!res.ok) throw new Error(data.error ?? t("saveFailed"));
      if (data.commendations?.awarded?.length) {
        setMessage(t("awarded", { badges: data.commendations.awarded.join(", ") }));
      } else {
        setMessage(t("saved"));
      }
      await load(filter);
      setSelectedId(null);
      setNotes("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">{t("title")}</h2>
        <p className="text-sm text-[#8b949e]">{t("subtitle")}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          ["pending", t("filterPending")],
          ["applied", t("filterApplied")],
          ["dismissed", t("filterDismissed")],
          ["all", t("filterAll")],
        ].map(([value, label]) => (
          <Button
            key={value}
            variant={filter === value ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(value)}
          >
            {label}
          </Button>
        ))}
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {message ? <p className="text-sm text-[#3fb950]">{message}</p> : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,20rem)]">
        <div className="overflow-x-auto rounded-xl border border-[#30363d]">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[#161b22] text-[#8b949e]">
              <tr>
                <th className="px-4 py-2">{t("colTime")}</th>
                <th className="px-4 py-2">{t("colLocale")}</th>
                <th className="px-4 py-2">{t("colKey")}</th>
                <th className="px-4 py-2">{t("colStatus")}</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr
                  key={report.id}
                  className={`cursor-pointer border-t border-[#30363d] ${selectedId === report.id ? "bg-[#21262d]" : ""}`}
                  onClick={() => {
                    setSelectedId(report.id);
                    setNotes(report.adminNotes ?? "");
                  }}
                >
                  <td className="px-4 py-2 whitespace-nowrap text-[#8b949e]">
                    {new Date(report.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2">{report.locale}</td>
                  <td className="max-w-xs truncate px-4 py-2">
                    {report.i18nKey ?? report.displayedText}
                  </td>
                  <td className="px-4 py-2">{report.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selected ? (
          <div className="space-y-3 rounded-xl border border-[#30363d] bg-[#161b22] p-4">
            <div>
              <p className="text-xs text-[#8b949e]">{t("displayed")}</p>
              <p className="text-sm">{selected.displayedText}</p>
            </div>
            <div>
              <p className="text-xs text-[#8b949e]">{t("suggested")}</p>
              <p className="text-sm">{selected.suggestedTranslation}</p>
            </div>
            <label className="block space-y-1 text-sm">
              <span className="text-[#8b949e]">{t("adminNotes")}</span>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </label>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => updateStatus("applied")}>
                {t("apply")}
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => updateStatus("dismissed")}
              >
                {t("dismiss")}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
