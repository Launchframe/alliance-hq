"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { HotkeyBindingDisplay } from "@/components/hotkeys/hotkey-display";
import { useHotkeys } from "@/components/hotkeys/HotkeyProvider";
import {
  isHotkeyActionAllowed,
  listVisibleHotkeyActions,
} from "@/lib/hotkeys/actions.registry";
import type { HotkeyCategory } from "@/lib/hotkeys/types";

type SortMode = "alphabetical" | "lastModified";

type Props = {
  sessionPermissions: readonly string[];
  isConnected: boolean;
  operatingMode?: "ashed" | "native" | null;
  showVideoQueue?: boolean;
};

export function HotkeysSettingsClient({
  sessionPermissions,
  isConnected,
  operatingMode = null,
  showVideoQueue = false,
}: Props) {
  const t = useTranslations("hotkeys");
  const {
    effectiveBindings,
    overrides,
    canEdit,
    saveBinding,
    resetBinding,
  } = useHotkeys();
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("alphabetical");
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const permissionSet = useMemo(
    () => new Set(sessionPermissions),
    [sessionPermissions],
  );

  const rows = useMemo(() => {
    const actions = listVisibleHotkeyActions(sessionPermissions, {
      isConnected,
      operatingMode,
      showVideoQueue,
    });

    const bindingMap = new Map(
      effectiveBindings.map((entry) => [entry.actionId, entry]),
    );

    const filtered = actions
      .map((action) => {
        const effective = bindingMap.get(action.id);
        const allowed = isHotkeyActionAllowed(action, permissionSet, {
          isConnected,
          operatingMode,
          showVideoQueue,
        });
        return {
          action,
          binding: effective?.binding ?? null,
          updatedAt: overrides[action.id]?.updatedAt ?? null,
          allowed,
        };
      })
      .filter((row) => {
        const label = t(row.action.labelKey as "actions.global.openPalette");
        return label.toLowerCase().includes(search.trim().toLowerCase());
      });

    filtered.sort((a, b) => {
      if (sortMode === "lastModified") {
        const aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0;
        const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0;
        return bTime - aTime;
      }
      const aLabel = t(a.action.labelKey as "actions.global.openPalette");
      const bLabel = t(b.action.labelKey as "actions.global.openPalette");
      return aLabel.localeCompare(bLabel);
    });

    return filtered;
  }, [
    effectiveBindings,
    isConnected,
    operatingMode,
    overrides,
    permissionSet,
    search,
    sessionPermissions,
    showVideoQueue,
    sortMode,
    t,
  ]);

  const grouped = useMemo(() => {
    const groups = new Map<HotkeyCategory, typeof rows>();
    for (const row of rows) {
      const items = groups.get(row.action.category) ?? [];
      items.push(row);
      groups.set(row.action.category, items);
    }
    return [...groups.entries()];
  }, [rows]);

  async function startEditing(actionId: string) {
    setEditingActionId(actionId);
    setMessage(t("recorderPrompt"));

    function onKeyDown(event: KeyboardEvent) {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setEditingActionId(null);
        setMessage(null);
        document.removeEventListener("keydown", onKeyDown, true);
        return;
      }

      void (async () => {
        const modifiers = [
          ...(event.altKey ? (["alt"] as const) : []),
          ...(event.shiftKey ? (["shift"] as const) : []),
          ...(event.metaKey ? (["meta"] as const) : []),
          ...(event.ctrlKey ? (["ctrl"] as const) : []),
        ];
        const key =
          event.key.length === 1 ? event.key.toLowerCase() : event.key;
        const binding =
          modifiers.length > 0
            ? { modifiers: [...modifiers], key }
            : { key };

        const error = await saveBinding(actionId, binding);
        document.removeEventListener("keydown", onKeyDown, true);
        setEditingActionId(null);
        setMessage(error);
      })();
    }

    document.addEventListener("keydown", onKeyDown, true);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 min-w-0 w-full">
      <div>
        <h1 className="text-2xl font-semibold text-[#e6edf3]">{t("settingsTitle")}</h1>
        <p className="mt-2 text-sm text-[#8b949e]">{t("settingsDescription")}</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("searchPlaceholder")}
          className="min-w-0 flex-1 rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-[#e6edf3]"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setSortMode("alphabetical")}
            className={`rounded-lg border px-3 py-2 text-xs ${
              sortMode === "alphabetical"
                ? "border-[#388bfd] text-[#e6edf3]"
                : "border-[#30363d] text-[#8b949e]"
            }`}
          >
            {t("sortAlphabetical")}
          </button>
          <button
            type="button"
            onClick={() => setSortMode("lastModified")}
            className={`rounded-lg border px-3 py-2 text-xs ${
              sortMode === "lastModified"
                ? "border-[#388bfd] text-[#e6edf3]"
                : "border-[#30363d] text-[#8b949e]"
            }`}
          >
            {t("sortLastModified")}
          </button>
        </div>
      </div>

      {message ? (
        <p className="rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-[#c9d1d9]">
          {message}
        </p>
      ) : null}

      {canEdit ? (
        <button
          type="button"
          onClick={() => void resetBinding("all")}
          className="rounded-lg border border-[#30363d] px-3 py-2 text-xs text-[#8b949e] hover:text-[#e6edf3]"
        >
          {t("resetAll")}
        </button>
      ) : null}

      <div className="space-y-6">
        {grouped.map(([category, items]) => (
          <section key={category} className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#6e7681]">
              {t(`categories.${category}` as "categories.global")}
            </h2>
            <ul className="space-y-2">
              {items.map((row) => (
                <li
                  key={row.action.id}
                  className={`flex flex-col gap-3 rounded-xl border border-[#30363d] bg-[#161b22] p-4 sm:flex-row sm:items-center sm:justify-between ${
                    row.allowed ? "" : "opacity-60"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#e6edf3]">
                      {t(row.action.labelKey as "actions.global.openPalette")}
                    </p>
                    {!row.allowed ? (
                      <p className="mt-1 text-xs text-[#8b949e]">
                        {t("permissionRequired")}
                      </p>
                    ) : null}
                    {row.updatedAt ? (
                      <p className="mt-1 text-xs text-[#6e7681]">
                        {t("lastModified", {
                          date: new Date(row.updatedAt).toLocaleString(),
                        })}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {row.binding ? (
                      <HotkeyBindingDisplay binding={row.binding} />
                    ) : null}
                    {canEdit && row.allowed ? (
                      <>
                        <button
                          type="button"
                          disabled={editingActionId === row.action.id}
                          onClick={() => void startEditing(row.action.id)}
                          className="rounded-lg border border-[#30363d] px-3 py-1.5 text-xs text-[#e6edf3] hover:bg-[#21262d]"
                        >
                          {t("editBinding")}
                        </button>
                        {overrides[row.action.id] ? (
                          <button
                            type="button"
                            onClick={() => void resetBinding(row.action.id)}
                            className="rounded-lg border border-[#30363d] px-3 py-1.5 text-xs text-[#8b949e] hover:text-[#e6edf3]"
                          >
                            {t("resetBinding")}
                          </button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
