"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

type Scope = "me" | "alliance";

type SpendResponse = {
  totalCents: number;
  currency: string;
  from: string;
  to: string;
  receipts: Array<{
    id: string;
    purchasedAt: string;
    amountCents: number;
    recipientDisplayName: string | null;
    donorDisplayName: string | null;
    note: string | null;
  }>;
  error?: string;
};

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function windowRange(
  kind: "7d" | "30d" | "month" | "custom",
  customFrom: string,
  customTo: string,
): { from: string; to: string } {
  const now = new Date();
  const to = isoDate(now);
  if (kind === "7d") {
    const from = new Date(now);
    from.setUTCDate(from.getUTCDate() - 6);
    return { from: isoDate(from), to };
  }
  if (kind === "30d") {
    const from = new Date(now);
    from.setUTCDate(from.getUTCDate() - 29);
    return { from: isoDate(from), to };
  }
  if (kind === "month") {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { from: isoDate(from), to };
  }
  return { from: customFrom || to, to: customTo || to };
}

function formatUsd(cents: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function StoreSpendClient({ canAlliance }: { canAlliance: boolean }) {
  const t = useTranslations("members.profile");
  const [scope, setScope] = useState<Scope>("me");
  const [windowKind, setWindowKind] = useState<"7d" | "30d" | "month" | "custom">(
    "30d",
  );
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [data, setData] = useState<SpendResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const range = useMemo(
    () => windowRange(windowKind, customFrom, customTo),
    [windowKind, customFrom, customTo],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        scope,
        from: range.from,
        to: range.to,
      });
      const res = await fetch(`/api/donations/store-spend?${params}`);
      const body = (await res.json()) as SpendResponse;
      if (!res.ok) {
        setError(body.error ?? t("storeSpendEmpty"));
        setData(null);
        return;
      }
      setData(body);
    } catch {
      setError(t("storeSpendEmpty"));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [scope, range.from, range.to, t]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      void load();
    });
    return () => cancelAnimationFrame(id);
  }, [load]);

  return (
    <div className="mx-auto w-full min-w-0 max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-hq-fg">{t("storeSpendTitle")}</h1>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`rounded-lg px-3 py-1.5 text-sm ${
            scope === "me"
              ? "bg-sky-600 text-white"
              : "border border-hq-border text-hq-fg"
          }`}
          onClick={() => setScope("me")}
        >
          {t("storeSpendMy")}
        </button>
        {canAlliance ? (
          <button
            type="button"
            className={`rounded-lg px-3 py-1.5 text-sm ${
              scope === "alliance"
                ? "bg-sky-600 text-white"
                : "border border-hq-border text-hq-fg"
            }`}
            onClick={() => setScope("alliance")}
          >
            {t("storeSpendAlliance")}
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["7d", "storeSpendWindow7d"],
            ["30d", "storeSpendWindow30d"],
            ["month", "storeSpendWindowMonth"],
            ["custom", "storeSpendWindowCustom"],
          ] as const
        ).map(([kind, key]) => (
          <button
            key={kind}
            type="button"
            className={`rounded-lg px-3 py-1.5 text-sm ${
              windowKind === kind
                ? "bg-hq-surface text-hq-fg ring-1 ring-sky-500"
                : "border border-hq-border text-hq-fg-muted"
            }`}
            onClick={() => setWindowKind(kind)}
          >
            {t(key)}
          </button>
        ))}
      </div>

      {windowKind === "custom" ? (
        <div className="flex flex-wrap gap-3">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="rounded-lg border border-hq-border bg-hq-bg px-3 py-2 text-sm text-hq-fg"
          />
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="rounded-lg border border-hq-border bg-hq-bg px-3 py-2 text-sm text-hq-fg"
          />
        </div>
      ) : null}

      <div className="rounded-xl border border-hq-border bg-hq-surface p-5">
        <p className="text-xs font-medium uppercase tracking-wider text-hq-fg-subtle">
          {t("storeSpendTotal")}
        </p>
        <p className="mt-1 text-3xl font-semibold tabular-nums text-hq-fg">
          {loading ? "…" : formatUsd(data?.totalCents ?? 0)}
        </p>
      </div>

      {error ? (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      {!loading && data && data.receipts.length === 0 ? (
        <p className="text-sm text-hq-fg-muted">{t("storeSpendEmpty")}</p>
      ) : null}

      {data && data.receipts.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-hq-border">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-hq-surface text-hq-fg-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Amount</th>
                <th className="px-3 py-2 font-medium">Recipient</th>
                {scope === "alliance" ? (
                  <th className="px-3 py-2 font-medium">Donor</th>
                ) : null}
                <th className="px-3 py-2 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {data.receipts.map((row) => (
                <tr key={row.id} className="border-t border-hq-border">
                  <td className="px-3 py-2 text-hq-fg">
                    {row.purchasedAt.slice(0, 10)}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-hq-fg">
                    {formatUsd(row.amountCents)}
                  </td>
                  <td className="px-3 py-2 text-hq-fg">
                    {row.recipientDisplayName ?? "—"}
                  </td>
                  {scope === "alliance" ? (
                    <td className="px-3 py-2 text-hq-fg">
                      {row.donorDisplayName ?? "—"}
                    </td>
                  ) : null}
                  <td className="px-3 py-2 text-hq-fg-muted">{row.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
