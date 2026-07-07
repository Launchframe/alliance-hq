"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { useFormatAccountDateTime } from "@/components/timezone/TimezoneProvider";

type Stats = {
  database: { ok: boolean; host: string; error?: string };
  counts: Record<string, number>;
  config: Record<string, boolean>;
  recentQueuedJobs: Array<{ id: string; fileName: string | null; createdAt: string }>;
};

type Role = {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
};

export function AdminSystemConsole() {
  const t = useTranslations("admin.systemPage");
  const formatDateTime = useFormatAccountDateTime();
  const [stats, setStats] = useState<Stats | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/admin/system");
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as { stats: Stats; roles: Role[] };
        setStats(data.stats);
        setRoles(data.roles);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("loadFailed"));
      }
    })();
  }, [t]);

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!stats) return <p className="text-sm text-hq-fg-muted">{t("loading")}</p>;

  const countEntries = Object.entries(stats.counts);

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
        <h2 className="font-medium">{t("databaseTitle")}</h2>
        <p className={`mt-2 text-sm ${stats.database.ok ? "text-hq-green" : "text-red-400"}`}>
          {stats.database.ok ? t("databaseOk") : stats.database.error ?? t("databaseBad")}
        </p>
        <p className="mt-1 font-mono text-xs text-hq-fg-muted">
          {t("databaseHost", { host: stats.database.host })}
        </p>
      </section>

      <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
        <h2 className="font-medium">{t("countsTitle")}</h2>
        <dl className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {countEntries.map(([key, value]) => (
            <div key={key} className="rounded-lg border border-hq-border px-3 py-2">
              <dt className="text-xs text-hq-fg-muted">{t(`counts.${key}` as never)}</dt>
              <dd className="text-lg font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
        <h2 className="font-medium">{t("configTitle")}</h2>
        <ul className="mt-3 space-y-1 text-sm">
          {Object.entries(stats.config).map(([key, ok]) => (
            <li key={key} className={ok ? "text-hq-green" : "text-hq-danger"}>
              {t(`config.${key}` as never)}: {ok ? "✓" : "✗"}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-hq-fg-muted">{t("bootstrapHint")}</p>
      </section>

      {stats.recentQueuedJobs.length > 0 ? (
        <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
          <h2 className="font-medium">{t("queuedTitle")}</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {stats.recentQueuedJobs.map((job) => (
              <li key={job.id} className="font-mono text-xs text-hq-fg-muted">
                {job.fileName ?? job.id} · {formatDateTime(job.createdAt)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
        <h2 className="font-medium">{t("rolesTitle")}</h2>
        <div className="mt-3 space-y-4">
          {roles.map((role) => (
            <div key={role.id}>
              <p className="font-medium capitalize">{role.name}</p>
              {role.description ? (
                <p className="text-xs text-hq-fg-muted">{role.description}</p>
              ) : null}
              <p className="mt-1 text-xs text-hq-fg-muted">
                {role.permissions.join(", ")}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
