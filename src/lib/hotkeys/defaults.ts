import type { HotkeyActionId } from "@/lib/hotkeys/actions.registry";
import type { HotkeyBinding } from "@/lib/hotkeys/types";

function seq(...keys: string[]): HotkeyBinding {
  return { sequence: keys };
}

function chord(
  key: string,
  modifiers: HotkeyBinding["modifiers"] = [],
): HotkeyBinding {
  return { key, modifiers };
}

const DEFAULT_HOTKEY_BINDINGS_IMPL = {
  "global.openPalette": chord("k", ["meta"]),
  "global.openHotkeyReference": chord("/", ["shift"]),
  "global.focusSidebar": chord(".", ["meta"]),
  "global.connectAshed": seq("g", "k"),

  "nav.dashboard": seq("g", "d"),
  "nav.members": seq("g", "m"),
  "nav.vsPerformance": seq("g", "v"),
  "nav.donations": seq("g", "o"),
  "nav.storeSpend": seq("g", "2"),
  "nav.allianceExercise": seq("g", "e"),
  "nav.reports": seq("g", "r"),
  "nav.viralResistance": seq("g", "i"),
  "nav.myVr": seq("g", "j"),
  "nav.myThp": seq("g", "f"),
  // g+k is Connect Ashed; g+8 is free for My Kills
  "nav.myKills": seq("g", "8"),
  "nav.professions": seq("g", "'"),
  "nav.trains": seq("g", "t"),
  "nav.battlePlan": seq("g", "h"),
  "nav.timeOff": seq("g", "w"),
  "nav.bankManagement": seq("g", "9"),
  "nav.desertStorm": seq("g", "s"),
  "nav.canyonStorm": seq("g", "c"),
  "nav.otherEvents": seq("g", "n"),
  "nav.zombieSiege": seq("g", "z"),
  "nav.dataManagement": seq("g", "a"),
  "nav.videoUpload": seq("g", "u"),
  "nav.videoQueue": seq("g", "q"),
  "nav.reminders": seq("g", "l"),
  "nav.adminPortal": seq("g", "p"),
  "nav.opsInbox": seq("g", "b"),
  "nav.account": seq("g", ","),
  "nav.settings": seq("g", ";"),
  "nav.discordBotGuide": seq("g", "x"),
  "nav.gettingStartedGuide": seq("g", "w"),
  "nav.discordTrainGuide": seq("g", "y"),
  "nav.allianceOnboardingGuide": seq("g", "h"),

  "admin.nav.overview": { key: "1" },
  "admin.nav.inbox": { key: "2" },
  "admin.nav.system": { key: "3" },
  "admin.nav.gameSeasons": { key: "4" },
  "admin.nav.alliances": { key: "5" },
  "admin.nav.users": { key: "6" },
  "admin.nav.audit": { key: "7" },
  "admin.nav.videoJobs": { key: "8" },
  "admin.nav.videoJobAnalytics": { key: "9" },
  "admin.nav.parseConfigs": { key: "0" },
  "admin.nav.experiments": { key: "a" },
  "admin.nav.hqEvents": { key: "b" },
  "admin.nav.commendations": { key: "c" },
  "admin.nav.bugReports": { key: "d" },
  "admin.nav.experienceFeedback": { key: "e" },
  "admin.nav.translationReports": { key: "f" },
  "admin.nav.memberLinkHelp": { key: "g" },
  "admin.nav.allianceSetupRequests": { key: "h" },
  "admin.nav.uidInspector": { key: "i" },

  "trains.spinWheel": { key: "w" },
  "trains.spinWeek": chord("w", ["shift"]),
  "trains.spinVip": { key: "v" },
  "trains.pickConductor": { key: "p" },
  "trains.pickVip": chord("p", ["shift"]),
  "trains.lockConductor": { key: "l" },
  "trains.viewPool": { key: "o" },
  "trains.scheduleWeek": { key: "[" },
  "trains.scheduleMonth": { key: "]" },
  "trains.goToToday": { key: "t" },
  "trains.template.1": chord("1", ["shift"]),
  "trains.template.2": chord("2", ["shift"]),
  "trains.template.3": chord("3", ["shift"]),
  "trains.template.4": chord("4", ["shift"]),
  "trains.template.5": chord("5", ["shift"]),
  "trains.template.6": chord("6", ["shift"]),
  "trains.template.7": chord("7", ["shift"]),
  "trains.template.8": chord("8", ["shift"]),
} satisfies Record<HotkeyActionId, HotkeyBinding>;

export const DEFAULT_HOTKEY_BINDINGS: Record<HotkeyActionId, HotkeyBinding> =
  DEFAULT_HOTKEY_BINDINGS_IMPL;
