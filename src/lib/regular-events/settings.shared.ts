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
  hasR4Channel: boolean;
  r4ChannelId: string | null;
  r4ChannelName: string | null;
  discordOpenUrl: string | null;
};

export type RegularEventRuleDto = {
  id: string;
  eventKey: RegularEventKey | string;
  eventLabel: string;
  scheduleKind: RegularEventScheduleKind | string;
  weeklySlots: RegularEventWeeklySlot[] | null;
  oneShotDates: string[] | null;
  biweeklyPhaseMonday: string | null;
  intervalDays: number | null;
  anchorTimeSt: string | null;
  announceLeadMinutes: number;
  active: boolean;
};

export type RegularEventsSettings = {
  announcementsEnabled: boolean;
  canyonStormActive: boolean;
  guildChannelCount: number;
  r4ChannelCount: number;
  guilds: RegularEventsGuildLink[];
  rules: RegularEventRuleDto[];
  canManage: boolean;
};
