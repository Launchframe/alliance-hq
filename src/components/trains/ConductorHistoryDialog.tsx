"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { ConductorHistoryTable } from "@/components/trains/ConductorHistoryTable";
import { AppSelect } from "@/components/ui/AppSelect";
import { Dialog } from "@/components/ui/dialog";
import type { WeekConductorRecordSummary } from "@/lib/trains/conductor-record.shared";

type HistoryApiRecord = {
  id: string;
  date: string;
  conductorMemberId: string | null;
  conductorMemberName: string | null;
  vipMemberId: string | null;
  vipMemberName: string | null;
  conductorMechanism: string | null;
  vipMechanism: string | null;
  guardianIsVip: boolean;
  lockedAt: string | null;
};

type RosterMember = {
  memberId: string;
  name: string;
  allianceRank: number | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mechanismLabels: Record<string, string>;
  roster: RosterMember[];
  /** Pre-filter to one member (month toolbar "view history"). */
  initialMemberId?: string | null;
  initialMemberName?: string | null;
};

const PAGE_SIZE = 30;
/** Coalesce open-reset + rapid filter edits into one request. */
const FILTER_FETCH_DEBOUNCE_MS = 150;

function mapApiRecord(row: HistoryApiRecord): WeekConductorRecordSummary {
  return {
    id: row.id,
    date: row.date,
    conductorMemberId: row.conductorMemberId,
    conductorMemberName: row.conductorMemberName,
    vipMemberId: row.vipMemberId,
    vipMemberName: row.vipMemberName,
    conductorMechanism: row.conductorMechanism,
    vipMechanism: row.vipMechanism,
    guardianIsVip: row.guardianIsVip,
    lockedAt: row.lockedAt,
    substituteForMemberId: null,
    substituteForMemberName: null,
  };
}

export function ConductorHistoryDialog({
  open,
  onOpenChange,
  mechanismLabels,
  roster,
  initialMemberId,
  initialMemberName,
}: Props) {
  const t = useTranslations("trains.conductorHistory");
  const tRoot = useTranslations("trains");
  const [rows, setRows] = useState<WeekConductorRecordSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [memberId, setMemberId] = useState(initialMemberId ?? "");
  const [allianceRank, setAllianceRank] = useState("");

  const memberOptions = useMemo(
    () => [
      { value: "", label: t("filters.memberAll") },
      ...roster
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((member) => ({
          value: member.memberId,
          label:
            member.allianceRank != null
              ? `${member.name} (R${member.allianceRank})`
              : member.name,
        })),
    ],
    [roster, t],
  );

  const rankOptions = useMemo(
    () => [
      { value: "", label: t("filters.rankAll") },
      ...([5, 4, 3, 2, 1] as const).map((rank) => ({
        value: String(rank),
        label: t("filters.rankOption", { rank }),
      })),
    ],
    [t],
  );

  const fetchPage = useCallback(
    async (
      nextOffset: number,
      append: boolean,
      filters?: {
        dateFrom: string;
        dateTo: string;
        memberId: string;
        allianceRank: string;
      },
    ) => {
      const active = filters ?? {
        dateFrom,
        dateTo,
        memberId,
        allianceRank,
      };
      setLoading(true);
      setLoadError(null);
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(nextOffset),
        });
        if (active.dateFrom) params.set("dateFrom", active.dateFrom);
        if (active.dateTo) params.set("dateTo", active.dateTo);
        if (active.memberId) params.set("memberId", active.memberId);
        if (active.allianceRank)
          params.set("allianceRank", active.allianceRank);

        const res = await fetch(
          `/api/trains/conductor/history?${params.toString()}`,
        );
        const body = (await res.json()) as {
          records?: HistoryApiRecord[];
          total?: number;
          error?: string;
        };
        if (!res.ok) {
          setLoadError(body.error ?? t("loadFailed"));
          if (!append) {
            setRows([]);
            setTotal(0);
          }
          return;
        }
        const mapped = (body.records ?? []).map(mapApiRecord);
        setTotal(body.total ?? mapped.length);
        setOffset(nextOffset);
        setRows((prev) => (append ? [...prev, ...mapped] : mapped));
      } catch {
        setLoadError(t("loadFailed"));
        if (!append) {
          setRows([]);
          setTotal(0);
        }
      } finally {
        setLoading(false);
      }
    },
    [allianceRank, dateFrom, dateTo, memberId, t],
  );

  // Parent remounts this dialog on each open (key includes open + member scope),
  // so initial useState already matches the session — only refetch on filter edits.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      void fetchPage(0, false);
    }, FILTER_FETCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, dateFrom, dateTo, memberId, allianceRank, fetchPage]);

  const hasMore = rows.length < total;
  const filtersActive =
    Boolean(dateFrom) ||
    Boolean(dateTo) ||
    Boolean(memberId) ||
    Boolean(allianceRank);

  const subtitle =
    initialMemberName && memberId === initialMemberId
      ? t("memberScope", { name: initialMemberName })
      : null;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("fullTitle")}
      className="max-w-3xl"
      data-testid="trains-conductor-history-dialog"
    >
      <div className="flex flex-col gap-4" data-testid="trains-conductor-history-body">
        {subtitle ? (
          <p className="text-sm text-hq-fg-muted">{subtitle}</p>
        ) : null}

        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div
            className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
            data-testid="trains-conductor-history-filters"
          >
            <label className="flex flex-col gap-1 text-xs text-hq-fg-muted">
              {t("filters.dateFrom")}
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="rounded-lg border border-hq-border bg-hq-canvas px-2 py-1.5 text-sm text-hq-fg"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-hq-fg-muted">
              {t("filters.dateTo")}
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="rounded-lg border border-hq-border bg-hq-canvas px-2 py-1.5 text-sm text-hq-fg"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-hq-fg-muted">
              {t("filters.member")}
              <AppSelect
                value={memberId}
                onChange={setMemberId}
                options={memberOptions}
                searchable
                searchMode="fuzzy"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-hq-fg-muted">
              {t("filters.rank")}
              <AppSelect
                value={allianceRank}
                onChange={setAllianceRank}
                options={rankOptions}
              />
            </label>
          </div>

          <button
            type="button"
            disabled={loading || !filtersActive}
            onClick={() => {
              setDateFrom("");
              setDateTo("");
              setMemberId("");
              setAllianceRank("");
            }}
            className="shrink-0 rounded-lg border border-hq-border px-3 py-1.5 text-sm text-hq-fg-muted hover:text-hq-fg disabled:opacity-50 md:self-auto"
            data-testid="trains-conductor-history-clear"
          >
            {t("filters.clear")}
          </button>
        </div>

        {total > 0 ? (
          <span className="text-xs text-hq-fg-muted">
            {t("resultCount", { shown: rows.length, total })}
          </span>
        ) : null}

        {loadError ? (
          <p className="rounded-lg border border-hq-danger/40 bg-hq-danger/10 px-3 py-2 text-sm text-hq-danger">
            {loadError}
          </p>
        ) : null}

        {loading && rows.length === 0 ? (
          <p className="text-sm text-hq-fg-muted">{t("loading")}</p>
        ) : (
          <ConductorHistoryTable
            rows={rows}
            mechanismLabels={mechanismLabels}
            labels={{
              title: t("title"),
              empty: t("empty"),
              date: t("date"),
              conductor: t("conductor"),
              vip: t("vip"),
              guardian: tRoot("guardian"),
              locked: t("locked"),
              noneYet: tRoot("noneYet"),
              guardianIsVip: tRoot("guardianIsVipHint"),
              guardianIsConductor: tRoot("guardianIsConductorHint"),
            }}
          />
        )}

        {hasMore ? (
          <div className="flex justify-center">
            <button
              type="button"
              disabled={loading}
              onClick={() => void fetchPage(offset + PAGE_SIZE, true)}
              className="rounded-lg border border-hq-border px-4 py-2 text-sm font-medium text-hq-fg hover:bg-hq-canvas disabled:opacity-50"
              data-testid="trains-conductor-history-load-more"
            >
              {loading ? t("loadingMore") : t("loadMore")}
            </button>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
