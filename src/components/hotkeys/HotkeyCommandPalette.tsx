"use client";

import { Command } from "cmdk";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { HotkeyBindingDisplay } from "@/components/hotkeys/hotkey-display";
import { useHotkeys } from "@/components/hotkeys/HotkeyProvider";
import { safeRunHotkeyDispatch } from "@/lib/hotkeys/safe-execute.shared";
import { Dialog } from "@/components/ui/dialog";
import {
  listVisibleHotkeyActions,
} from "@/lib/hotkeys/actions.registry";
import { parseKeyboardEvent } from "@/lib/hotkeys/engine";
import type { HotkeyBinding } from "@/lib/hotkeys/types";

type Props = {
  sessionPermissions: readonly string[];
  isConnected: boolean;
  operatingMode?: "ashed" | "native" | null;
  showVideoQueue?: boolean;
};

export function HotkeyCommandPalette({
  sessionPermissions,
  isConnected,
  operatingMode = null,
  showVideoQueue = false,
}: Props) {
  const t = useTranslations("hotkeys");
  const {
    paletteOpen,
    closePalette,
    effectiveBindings,
    canEdit,
    saveBinding,
    executeAction,
  } = useHotkeys();
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [recorderError, setRecorderError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const visibleActions = useMemo(
    () =>
      listVisibleHotkeyActions(sessionPermissions, {
        isConnected,
        operatingMode,
        showVideoQueue,
      }).filter((action) => action.scope !== "admin-sequence"),
    [isConnected, operatingMode, sessionPermissions, showVideoQueue],
  );

  const bindingByActionId = useMemo(() => {
    const map = new Map<string, HotkeyBinding>();
    for (const entry of effectiveBindings) {
      map.set(entry.actionId, entry.binding);
    }
    return map;
  }, [effectiveBindings]);

  const grouped = useMemo(() => {
    const groups = new Map<string, typeof visibleActions>();
    for (const action of visibleActions) {
      const items = groups.get(action.category) ?? [];
      items.push(action);
      groups.set(action.category, items);
    }
    return [...groups.entries()];
  }, [visibleActions]);

  useEffect(() => {
    if (!editingActionId || !paletteOpen) return;

    async function onKeyDown(event: KeyboardEvent) {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setEditingActionId(null);
        setRecorderError(null);
        return;
      }

      const parsed = parseKeyboardEvent(event);
      const binding: HotkeyBinding =
        parsed.modifiers.length > 0
          ? { modifiers: parsed.modifiers, key: parsed.key }
          : { key: parsed.key };

      const error = await saveBinding(editingActionId!, binding);
      if (error) {
        setRecorderError(error);
        return;
      }

      setEditingActionId(null);
      setRecorderError(null);
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [editingActionId, paletteOpen, saveBinding]);

  return (
    <Dialog
      open={paletteOpen}
      onOpenChange={(open) => {
        if (!open) {
          closePalette();
          setEditingActionId(null);
          setRecorderError(null);
          setSearch("");
        }
      }}
      title={t("paletteTitle")}
      className="max-w-2xl p-0"
    >
      <div className="border-b border-[#30363d] px-4 py-3" data-hotkey-ignore>
        <p className="text-sm font-medium text-[#e6edf3]">{t("paletteTitle")}</p>
        <p className="mt-1 text-xs text-[#8b949e]">{t("paletteDescription")}</p>
      </div>

      <Command
        className="flex max-h-[min(70vh,32rem)] flex-col overflow-hidden"
        shouldFilter
      >
        <div className="border-b border-[#30363d] px-3 py-2" data-hotkey-ignore>
          <Command.Input
            value={search}
            onValueChange={setSearch}
            placeholder={t("searchPlaceholder")}
            className="w-full rounded-md border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-[#e6edf3] outline-none placeholder:text-[#6e7681]"
            autoFocus
          />
        </div>

        {editingActionId ? (
          <div className="border-b border-[#30363d] bg-[#161b22] px-4 py-3 text-sm text-[#c9d1d9]">
            <p>{t("recorderPrompt")}</p>
            {recorderError ? (
              <p className="mt-2 text-xs text-[#f85149]">{recorderError}</p>
            ) : null}
          </div>
        ) : null}

        <Command.List className="overflow-y-auto p-2">
          <Command.Empty className="px-3 py-6 text-center text-sm text-[#8b949e]">
            {t("noResults")}
          </Command.Empty>

          {grouped.map(([category, actions]) => (
            <Command.Group
              key={category}
              heading={t(`categories.${category}` as "categories.global")}
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-[#6e7681]"
            >
              {actions.map((action) => {
                const binding = bindingByActionId.get(action.id);
                return (
                  <Command.Item
                    key={action.id}
                    value={`${t(action.labelKey as "actions.global.openPalette")} ${category}`}
                    onSelect={() => {
                      if (editingActionId) return;
                      closePalette();
                      setSearch("");
                      safeRunHotkeyDispatch(action.id, () =>
                        executeAction(action.id),
                      );
                    }}
                    className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm text-[#e6edf3] aria-selected:bg-[#21262d]"
                  >
                    <span className="min-w-0 truncate">
                      {t(action.labelKey as "actions.global.openPalette")}
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      {binding ? <HotkeyBindingDisplay binding={binding} /> : null}
                      {canEdit ? (
                        <button
                          type="button"
                          className="rounded border border-[#30363d] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[#8b949e] hover:text-[#e6edf3]"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setEditingActionId(action.id);
                            setRecorderError(null);
                          }}
                        >
                          {t("editBinding")}
                        </button>
                      ) : null}
                    </div>
                  </Command.Item>
                );
              })}
            </Command.Group>
          ))}
        </Command.List>
      </Command>
    </Dialog>
  );
}
