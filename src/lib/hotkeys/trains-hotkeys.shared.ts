import type { HotkeyActionId } from "@/lib/hotkeys/actions.registry";

/** Compile-time checklist for trains page handler registration. */
export const TRAINS_HOTKEY_ACTION_IDS = [
  "trains.spinWheel",
  "trains.spinWeek",
  "trains.spinVip",
  "trains.pickConductor",
  "trains.pickVip",
  "trains.lockConductor",
  "trains.viewPool",
  "trains.scheduleWeek",
  "trains.scheduleMonth",
  "trains.goToToday",
  "trains.template.1",
  "trains.template.2",
  "trains.template.3",
  "trains.template.4",
  "trains.template.5",
  "trains.template.6",
  "trains.template.7",
  "trains.template.8",
] as const satisfies readonly HotkeyActionId[];

export type TrainsHotkeyActionId = (typeof TRAINS_HOTKEY_ACTION_IDS)[number];
