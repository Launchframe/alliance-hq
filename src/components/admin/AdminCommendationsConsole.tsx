"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type Commendation = {
  id: string;
  slug: string;
  label: string;
  sortOrder: number;
  active: number;
};

export function AdminCommendationsConsole() {
  const t = useTranslations("admin.commendationsPage");
  const [commendations, setCommendations] = useState<Commendation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [slug, setSlug] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/commendations");
    if (!res.ok) throw new Error(await res.text());
    const data = (await res.json()) as { commendations: Commendation[] };
    setCommendations(data.commendations);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("loadFailed"));
      }
    })();
  }, [load, t]);

  async function createCommendation() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/commendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, label }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? t("saveFailed"));
      }
      setSlug("");
      setLabel("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(id: string, active: boolean) {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/commendations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      if (!res.ok) throw new Error(await res.text());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="overflow-x-auto rounded-xl border border-[#30363d]">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[#161b22] text-[#8b949e]">
            <tr>
              <th className="px-4 py-2">{t("table.slug")}</th>
              <th className="px-4 py-2">{t("table.label")}</th>
              <th className="px-4 py-2">{t("table.order")}</th>
              <th className="px-4 py-2">{t("table.active")}</th>
            </tr>
          </thead>
          <tbody>
            {commendations.map((row) => (
              <tr key={row.id} className="border-t border-[#30363d]">
                <td className="px-4 py-2 font-mono text-xs">{row.slug}</td>
                <td className="px-4 py-2">{row.label}</td>
                <td className="px-4 py-2">{row.sortOrder}</td>
                <td className="px-4 py-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void toggleActive(row.id, row.active !== 1)}
                    className="text-[#58a6ff] hover:underline disabled:opacity-50"
                  >
                    {row.active === 1 ? t("activeYes") : t("activeNo")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
        <h2 className="font-medium">{t("createTitle")}</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder={t("slugPlaceholder")}
            className="rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm"
          />
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("labelPlaceholder")}
            className="rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={saving || !slug.trim() || !label.trim()}
            onClick={() => void createCommendation()}
            className="rounded-lg bg-[#238636] px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {t("createButton")}
          </button>
        </div>
      </section>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </div>
  );
}
