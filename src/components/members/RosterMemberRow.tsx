"use client";

import { useTranslations } from "next-intl";

import { AllianceLinkedCommandersBadge } from "@/components/alliance/AllianceLinkedCommandersBadge";
import { Link } from "@/i18n/navigation";
import {
  MAIN_SQUAD_LABEL_KEYS,
  MAIN_SQUAD_TYPES,
  type MainSquadType,
} from "@/lib/commanders/main-squad.shared";
import { preventDefaultFormSubmit } from "@/lib/client/form-enter-submit.shared";
import {
  formatMemberRankDisplay,
  parseAshedMemberAllianceRank,
} from "@/lib/members/alliance-rank";
import type { RosterColumnId, RosterMergedRow } from "@/lib/members/roster-index.shared";
import {
  rosterRowTotalHeroPower,
  visibleRosterColumns,
} from "@/lib/members/roster-index.shared";

function thpDisplay(value: number): string {
  if (value <= 0) return "—";
  return value.toLocaleString();
}

function rankDisplay(rank: number | null): string {
  return rank != null ? `R${rank}` : "—";
}

function vrDisplay(vr: number | null): string {
  return vr != null ? vr.toLocaleString() : "—";
}

function memberStatusLabel(
  status: string | undefined,
  t: (key: "statusActive" | "statusFormer") => string,
): string {
  if (status === "former") return t("statusFormer");
  if (status === "active" || !status) return t("statusActive");
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function memberStatusBadgeClass(status?: string): string {
  const base =
    "inline-flex min-w-[5.5rem] items-center justify-center rounded-full px-2.5 py-0.5 text-xs font-medium";
  if (status === "former") {
    return `${base} bg-hq-border text-hq-fg-muted ring-1 ring-[#484f58]`;
  }
  return `${base} bg-[#23863633] text-hq-green ring-1 ring-[#23863666]`;
}

type SquadEditProps = {
  row: RosterMergedRow;
  canEditRow: boolean;
  pendingSquad: MainSquadType | "" | undefined;
  isSaving: boolean;
  saveError: string | undefined;
  onPendingSquadChange: (value: MainSquadType | "") => void;
  onSave: () => void;
};

type Props = {
  row: RosterMergedRow;
  columnVisibility: Record<RosterColumnId, boolean>;
  editMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  showSquadEditColumn: boolean;
  squadEdit: SquadEditProps | null;
};

export function RosterMemberRow({
  row,
  columnVisibility,
  editMode,
  selected,
  onToggleSelect,
  showSquadEditColumn,
  squadEdit,
}: Props) {
  const tMembers = useTranslations("members");
  const tCommanders = useTranslations("commandersIndex");
  const visibleColumns = visibleRosterColumns(columnVisibility);
  const { member, commander } = row;
  const unknown = tMembers("noPreviousNames");
  const { rankLabel, titleLabel } = formatMemberRankDisplay(
    parseAshedMemberAllianceRank(member),
    unknown,
  );
  const previous =
    member.previous_names?.filter(Boolean).join(", ") || unknown;
  const statusLabel = memberStatusLabel(member.status, tMembers);
  const statusBadge = (
    <span className={memberStatusBadgeClass(member.status)}>
      {statusLabel}
    </span>
  );

  const rowClass = [
    "border-b border-hq-border/60 last:border-0",
    editMode ? "cursor-pointer" : "hover:bg-hq-surface/80",
    selected ? "bg-[#388bfd]/15 ring-1 ring-inset ring-[#388bfd]/35" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const selectionControl = editMode ? (
    <input
      type="checkbox"
      checked={selected}
      onChange={onToggleSelect}
      onClick={(event) => event.stopPropagation()}
      aria-label={tMembers("selectMember", { name: member.current_name })}
      className="size-4 shrink-0 rounded border-[#484f58] bg-hq-canvas accent-[#388bfd]"
    />
  ) : null;

  const nameContent = editMode ? (
    member.current_name
  ) : (
    <Link
      href={`/members/${member.id}`}
      className="text-hq-accent hover:underline"
    >
      {member.current_name}
    </Link>
  );

  function renderCell(columnId: RosterColumnId) {
    switch (columnId) {
      case "name":
        return nameContent;
      case "previousNames":
        return previous;
      case "allianceRank":
        return <span className="font-mono">{rankLabel}</span>;
      case "rankTitle":
        return titleLabel;
      case "status":
        return statusBadge;
      case "thp":
        return (
          <span className="font-mono">{thpDisplay(rosterRowTotalHeroPower(row))}</span>
        );
      case "mainSquad":
        return commander?.mainSquad ? (
          <>
            {tCommanders(`squad.${MAIN_SQUAD_LABEL_KEYS[commander.mainSquad]}`)}
            {commander.mainSquadSource === "officer_override" ? (
              <span className="ml-1 text-xs text-[#d29922]">
                {tCommanders("sourceOfficer")}
              </span>
            ) : commander.mainSquadSource === "self_report" ? (
              <span className="ml-1 text-xs text-hq-green">
                {tCommanders("sourceSelf")}
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-[#484f58]">{tCommanders("unreportedShort")}</span>
        );
      case "inGameRank":
        return (
          <>
            {rankDisplay(commander?.allianceRank ?? null)}
            {commander?.allianceRankTitle ? (
              <span className="ml-1 text-xs text-[#484f58]">
                {commander.allianceRankTitle}
              </span>
            ) : null}
          </>
        );
      case "vr":
        return (
          <span className="font-mono">
            {vrDisplay(commander?.highestBaseVr ?? null)}
          </span>
        );
      case "hqLinked":
        return commander?.hqLinked ? (
          <AllianceLinkedCommandersBadge label={tCommanders("badgeHqLinked")} />
        ) : (
          <span className="text-[#484f58]">—</span>
        );
      case "squadEdit":
        if (!squadEdit?.canEditRow) return null;
        return (
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              preventDefaultFormSubmit(event);
              squadEdit.onSave();
            }}
          >
            <select
              value={squadEdit.pendingSquad ?? commander?.mainSquad ?? ""}
              onChange={(event) =>
                squadEdit.onPendingSquadChange(
                  event.target.value as MainSquadType | "",
                )
              }
              disabled={squadEdit.isSaving}
              className="rounded-md border border-hq-border bg-hq-surface px-2 py-1 text-xs text-hq-fg disabled:opacity-50"
            >
              <option value="">{tCommanders("squadNone")}</option>
              {MAIN_SQUAD_TYPES.map((squad) => (
                <option key={squad} value={squad}>
                  {tCommanders(`squad.${MAIN_SQUAD_LABEL_KEYS[squad]}`)}
                </option>
              ))}
            </select>
            {squadEdit.pendingSquad != null &&
            squadEdit.pendingSquad !== (commander?.mainSquad ?? "") ? (
              <button
                type="submit"
                disabled={squadEdit.isSaving}
                className="rounded-md bg-hq-success px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
              >
                {squadEdit.isSaving
                  ? tCommanders("saving")
                  : tCommanders("save")}
              </button>
            ) : null}
            {squadEdit.saveError ? (
              <span className="text-xs text-hq-danger">{squadEdit.saveError}</span>
            ) : null}
          </form>
        );
      default: {
        const _exhaustive: never = columnId;
        return _exhaustive;
      }
    }
  }

  const mobileFields = visibleColumns.filter(
    (columnId) => columnId !== "name" && columnId !== "squadEdit",
  );

  return (
    <tr
      className={rowClass}
      onClick={editMode ? onToggleSelect : undefined}
      aria-selected={editMode ? selected : undefined}
    >
      {editMode ? (
        <td className="hidden px-2 py-3 text-center md:table-cell">
          {selectionControl}
        </td>
      ) : null}

      <td className="px-3 py-3 md:hidden sm:px-4">
        <div className="flex min-w-0 items-start gap-3">
          {editMode ? selectionControl : null}
          <div className="flex min-w-0 flex-col items-start gap-1.5">
            <div className="wrap-break-word font-medium">{nameContent}</div>
            {mobileFields.map((columnId) => (
              <div
                key={columnId}
                className="text-xs text-hq-fg-muted wrap-break-word"
              >
                <span className="font-medium text-hq-fg-subtle">
                  {tMembers(`rosterColumns.col.${columnId}`)}:{" "}
                </span>
                {renderCell(columnId)}
              </div>
            ))}
            {showSquadEditColumn && squadEdit?.canEditRow ? (
              <div className="w-full">{renderCell("squadEdit")}</div>
            ) : null}
          </div>
        </div>
      </td>

      {visibleColumns.map((columnId) => (
        <td
          key={columnId}
          className={`hidden px-4 py-3 md:table-cell ${
            columnId === "allianceRank" || columnId === "status"
              ? "text-center"
              : columnId === "name"
                ? "font-medium"
                : "text-hq-fg-muted"
          } ${columnId === "previousNames" ? "wrap-break-word" : ""}`}
        >
          {columnId === "name" ? (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {renderCell(columnId)}
              {columnVisibility.hqLinked &&
              !visibleColumns.includes("hqLinked") &&
              commander?.hqLinked ? (
                <AllianceLinkedCommandersBadge
                  label={tCommanders("badgeHqLinked")}
                />
              ) : null}
            </div>
          ) : (
            renderCell(columnId)
          )}
        </td>
      ))}

    </tr>
  );
}

export function rosterColumnHeaderLabel(
  columnId: RosterColumnId,
  tMembers: (key: string) => string,
  tCommanders: (key: string) => string,
): string {
  if (columnId === "thp") return tCommanders("colThp");
  if (columnId === "mainSquad") return tCommanders("colSquad");
  if (columnId === "inGameRank") return tCommanders("colInGameRank");
  if (columnId === "vr") return tCommanders("colVr");
  if (columnId === "hqLinked") return tCommanders("filterHqLink");
  if (columnId === "squadEdit") return tCommanders("colSquadEdit");
  if (columnId === "name") return tMembers("colName");
  if (columnId === "previousNames") return tMembers("colPreviousNames");
  if (columnId === "allianceRank") return tMembers("colRank");
  if (columnId === "rankTitle") return tMembers("colTitle");
  if (columnId === "status") return tMembers("colStatus");
  return tMembers(`rosterColumns.col.${columnId}`);
}
