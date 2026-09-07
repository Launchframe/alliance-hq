import type { RegularEventKey } from "@/lib/regular-events/catalog.shared";
import type {
  RegularEventScheduleKind,
  RegularEventWeeklySlot,
} from "@/lib/regular-events/types.shared";

export type RegularEventsGuildLink = {
  guildId: string;
  guildName: string | null;
  hasRegularEventsChannel: boolean;
  regularEventsChannelId: string | null;
  regularEventsChannelName: string | null;
  discordOpenUrl: string | null;
};

export type RegularEventRuleDto = {
  id: string;
  eventKey: RegularEventKey | string;
  eventLabel: string;
  scheduleKind: RegularEventScheduleKind | string;
  weeklySlots: RegularEventWeeklySlot[] | null;
  intervalDays: number | null;
  anchorTimeSt: string | null;
  announceLeadMinutes: number;
  active: boolean;
};

export type RegularEventsSettings = {
  announcementsEnabled: boolean;
  canyonStormActive: boolean;
  guildChannelCount: number;
  guilds: RegularEventsGuildLink[];
  rules: RegularEventRuleDto[];
  canManage: boolean;
};
