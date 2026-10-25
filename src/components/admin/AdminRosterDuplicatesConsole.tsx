"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { preventDefaultFormSubmit } from "@/lib/client/form-enter-submit.shared";
import type {
  RosterDuplicateInexactPair,
  RosterDuplicateMemberView,
  RosterDuplicateScan,
} from "@/lib/members/roster-duplicate-groups.shared";

type AllianceHit = { id: string; tag: string | null; name: string };

type BatchPayload = {
  merged: Array<{ ashedMemberId: string; name: string; code?: string }>;
  removed: Array<{ ashedMemberId: string; name: string; code?: string }>;
  skipped: Array<{ ashedMemberId: string; name: string; code?: string }>;
  failed: Array<{ ashedMemberId: string; name: string; code?: string }>;
};

export function AdminRosterDuplicatesConsole() {
  const t = useTranslations("admin.rosterDuplicates");
  const tAdmin = useTranslations("admin");
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<AllianceHit[]>([]);
  const [allianceId, setAllianceId] = useState<string | null>(null);
  const [allianceLabel, setAllianceLabel] = useState<string | null>(null);
  const [scan, setScan] = useState<RosterDuplicateScan | null>(null);
  const [scanKey, setScanKey] = useState("");
  const [overrideKey, setOverrideKey] = useState("");
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [inexactPairs, setInexactPairs] = useState<RosterDuplicateInexactPair[] | null>(
    null,
  );
  const [inexactAck, setInexactAck] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  const nextScanKey = scan
    ? `${allianceId ?? ""}:${scan.groups.map((group) => group.id).join(",")}:${scan.unmatchedLastRank.map((member) => member.ashedMemberId).join(",")}`
    : "";
  if (nextScanKey !== scanKey) {
    setScanKey(nextScanKey);
    setOverrideKey(nextScanKey);
    setOverrides({});
  } else if (overrideKey !== nextScanKey) {
    setOverrideKey(nextScanKey);
    setOverrides({});
  }

  const members = scan
    ? [
        ...scan.groups.flatMap((group) => group.members),
        ...scan.unmatchedLastRank,
      ]
    : [];

  function isChecked(member: RosterDuplicateMemberView): boolean {
    if (Object.prototype.hasOwnProperty.call(overrides, member.ashedMemberId)) {
      return overrides[member.ashedMemberId] ?? false;
    }
    return member.defaultChecked;
  }

  const selectedIds = members
    .filter((member) => isChecked(member))
    .map((member) => member.ashedMemberId);

  async function searchAlliances(event: FormEvent) {
    preventDefaultFormSubmit(event);
    setError(null);
    const response = await fetch(
      `/api/admin/alliances?q=${encodeURIComponent(query.trim())}&limit=20`,
    );
    if (!response.ok) {
      setError(tAdmin("loadFailed"));
      return;
    }
    const body = (await response.json()) as { alliances: AllianceHit[] };
    setHits(body.alliances);
  }

  async function loadScan(nextAllianceId: string) {
    setBusy(true);
    setError(null);
    const response = await fetch(
      `/api/admin/alliances/${encodeURIComponent(nextAllianceId)}/roster-duplicates`,
    );
    setBusy(false);
    if (!response.ok) {
      setError(tAdmin("loadFailed"));
      return;
    }
    setScan((await response.json()) as RosterDuplicateScan);
  }

  function toggle(member: RosterDuplicateMemberView) {
    setOverrides((current) => ({
      ...current,
      [member.ashedMemberId]: !isChecked(member),
    }));
  }

  function invert() {
    const next: Record<string, boolean> = {};
    for (const member of members) {
      next[member.ashedMemberId] = !isChecked(member);
    }
    setOverrides(next);
  }

  function applyBatch(body: BatchPayload) {
    const lines: string[] = [];
    for (const item of body.skipped) {
      if (item.code === "keeper") lines.push(t("keeperSkipped", { name: item.name }));
    }
    for (const item of body.failed) {
      if (
        item.code === "ashed_connection_required" ||
        item.code === "ashed_retire_failed"
      ) {
        lines.push(t("ashedConnection"));
      } else if (item.code === "no_recommended_keeper") {
        lines.push(t("ambiguousGroup"));
      }
    }
    setNotices(lines);
  }

  async function postAction(action: "merge" | "remove", confirmInexact = false) {
    if (!allianceId || selectedIds.length === 0) return;
    setBusy(true);
    setError(null);
    const response = await fetch(
      `/api/admin/alliances/${encodeURIComponent(allianceId)}/roster-duplicates`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ashedMemberIds: selectedIds,
          confirmInexact,
        }),
      },
    );
    const body = (await response.json()) as BatchPayload & {
      code?: string;
      pairs?: RosterDuplicateInexactPair[];
    };
    setBusy(false);
    if (response.status === 409 && body.code === "inexact_confirmation_required") {
      setInexactPairs(body.pairs ?? []);
      setInexactAck(false);
      return;
    }
    if (!response.ok) {
      if (body.code === "ambiguous_selection") {
        setNotices([t("ambiguousGroup")]);
        return;
      }
      setError(tAdmin("loadFailed"));
      return;
    }
    setInexactPairs(null);
    setRemoveOpen(false);
    applyBatch(body);
    await loadScan(allianceId);
  }

  const empty =
    scan != null && scan.groups.length === 0 && scan.unmatchedLastRank.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-hq-fg">{t("title")}</h1>
        <p className="mt-2 max-w-3xl text-sm text-hq-fg-muted">{t("intro")}</p>
      </div>

      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={searchAlliances}>
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm text-hq-fg">
          {t("allianceLabel")}
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("chooseAlliance")}
            className="h-10 rounded-lg border border-hq-border bg-hq-surface px-3 text-hq-fg"
          />
        </label>
        <Button type="submit" className="sm:self-end" variant="outline">
          {t("chooseAlliance")}
        </Button>
      </form>

      {hits.length > 0 ? (
        <ul className="space-y-1">
          {hits.map((hit) => (
            <li key={hit.id}>
              <button
                type="button"
                className="text-sm text-hq-fg underline"
                onClick={() => {
                  setAllianceId(hit.id);
                  setAllianceLabel(hit.tag ? `${hit.tag} · ${hit.name}` : hit.name);
                  setNotices([]);
                  void loadScan(hit.id);
                }}
              >
                {hit.tag ? `${hit.tag} · ${hit.name}` : hit.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {allianceLabel ? (
        <p className="text-sm text-hq-fg">
          {t("allianceLabel")}: {allianceLabel}
        </p>
      ) : null}
      {error ? <p className="text-sm text-hq-danger">{error}</p> : null}
      {notices.length > 0 ? (
        <ul className="space-y-1 text-sm text-hq-fg" data-testid="roster-duplicate-results">
          {notices.map((notice, index) => (
            <li key={`${notice}-${index}`}>{notice}</li>
          ))}
        </ul>
      ) : null}

      {scan && !empty ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={invert} disabled={busy}>
            {t("invert")}
          </Button>
          <Button
            type="button"
            onClick={() => void postAction("merge")}
            disabled={busy || selectedIds.length === 0}
          >
            {t("merge")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => setRemoveOpen(true)}
            disabled={busy || selectedIds.length === 0}
          >
            {t("remove")}
          </Button>
        </div>
      ) : null}

      {empty ? <p className="text-sm text-hq-fg-muted">{t("empty")}</p> : null}

      {scan?.groups.map((group) => (
        <section key={group.id} className="space-y-2 rounded-xl border border-hq-border p-4">
          <h2 className="text-sm font-medium text-hq-fg">
            {group.kind === "exact"
              ? t("exactGroup")
              : group.kind === "review"
                ? t("reviewGroup")
                : t("ambiguousGroup")}
          </h2>
          <ul className="space-y-2">
            {group.members.map((member) => (
              <MemberRow
                key={member.ashedMemberId}
                member={member}
                checked={isChecked(member)}
                locale={locale}
                onToggle={() => toggle(member)}
                labels={{
                  keep: t("keep"),
                  lastRankImport: t("lastRankImport"),
                  ashedRoster: t("ashedRoster"),
                  linkedAccount: t("linkedAccount"),
                }}
              />
            ))}
          </ul>
        </section>
      ))}

      {scan && scan.unmatchedLastRank.length > 0 ? (
        <section className="space-y-2 rounded-xl border border-hq-border p-4">
          <h2 className="text-sm font-medium text-hq-fg">{t("unmatchedTitle")}</h2>
          <ul className="space-y-2">
            {scan.unmatchedLastRank.map((member) => (
              <MemberRow
                key={member.ashedMemberId}
                member={member}
                checked={isChecked(member)}
                locale={locale}
                onToggle={() => toggle(member)}
                labels={{
                  keep: t("keep"),
                  lastRankImport: t("lastRankImport"),
                  ashedRoster: t("ashedRoster"),
                  linkedAccount: t("linkedAccount"),
                }}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <Dialog
        open={inexactPairs != null}
        onOpenChange={(open) => {
          if (!open) setInexactPairs(null);
        }}
        title={t("inexactTitle")}
        data-testid="roster-inexact-dialog"
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            preventDefaultFormSubmit(event);
            void postAction("merge", true);
          }}
        >
          <h2 className="text-base font-semibold text-hq-fg">{t("inexactTitle")}</h2>
          <p className="text-sm text-hq-fg-muted">{t("inexactBody")}</p>
          <ul className="space-y-1 text-sm text-hq-fg">
            {(inexactPairs ?? []).map((pair) => (
              <li key={`${pair.keeperName}-${pair.duplicateName}`}>
                {pair.keeperName} ← {pair.duplicateName}
              </li>
            ))}
          </ul>
          <label className="flex items-start gap-2 text-sm text-hq-fg">
            <input
              type="checkbox"
              checked={inexactAck}
              onChange={(event) => setInexactAck(event.target.checked)}
            />
            {t("inexactAck")}
          </label>
          <Button type="submit" disabled={!inexactAck || busy}>
            {t("inexactConfirm")}
          </Button>
        </form>
      </Dialog>

      <Dialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={t("removeTitle")}
        data-testid="roster-remove-dialog"
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            preventDefaultFormSubmit(event);
            void postAction("remove");
          }}
        >
          <h2 className="text-base font-semibold text-hq-fg">{t("removeTitle")}</h2>
          <p className="text-sm text-hq-fg-muted">{t("removeBody")}</p>
          <ul className="space-y-1 text-sm text-hq-fg">
            {members
              .filter((member) => isChecked(member))
              .map((member) => (
                <li key={member.ashedMemberId}>
                  {member.name}
                  {member.synthetic ? ` · ${t("lastRankImport")}` : ""}
                  {member.linkedAccount ? ` · ${t("linkedAccount")}` : ""}
                </li>
              ))}
          </ul>
          <Button type="submit" variant="destructive" disabled={busy}>
            {t("removeConfirm")}
          </Button>
        </form>
      </Dialog>
    </div>
  );
}

function MemberRow({
  member,
  checked,
  locale,
  onToggle,
  labels,
}: {
  member: RosterDuplicateMemberView;
  checked: boolean;
  locale: string;
  onToggle: () => void;
  labels: {
    keep: string;
    lastRankImport: string;
    ashedRoster: string;
    linkedAccount: string;
  };
}) {
  const source = member.synthetic ? labels.lastRankImport : labels.ashedRoster;
  const aria = member.keeper ? `${member.name}, ${labels.keep}` : `${member.name}, ${source}`;
  const stats = [
    member.profession,
    member.powerLevel,
    member.memberLevel != null ? member.memberLevel.toLocaleString(locale) : null,
    member.totalHeroPower != null
      ? member.totalHeroPower.toLocaleString(locale)
      : null,
  ].filter((part): part is string => Boolean(part));

  return (
    <li className="flex items-start gap-3">
      <input
        type="checkbox"
        className="mt-1"
        checked={checked}
        aria-label={aria}
        data-testid={`roster-check-${member.ashedMemberId}`}
        onChange={onToggle}
      />
      <div className="min-w-0">
        <p className="text-sm text-hq-fg">{member.name}</p>
        <p className="text-xs text-hq-fg-muted">
          {[
            member.keeper ? labels.keep : null,
            source,
            member.linkedAccount ? labels.linkedAccount : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {stats.length > 0 ? (
          <p className="text-xs text-hq-fg-muted">{stats.join(" · ")}</p>
        ) : null}
      </div>
    </li>
  );
}
