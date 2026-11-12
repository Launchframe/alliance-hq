import { addCalendarDays } from "@/lib/trains/game-time";

/** Wall-clock age after which a locked today no longer opens the hub on today. */
export const CONDUCTOR_LOCK_STALE_MS = 8 * 60 * 60 * 1000;

export type MemberInviteProfile = {
  /** Canonical or primary commander name. Null when HQ only has the roster name. */
  name: string | null;
  /** Troop power in millions. Null when HQ has no power string. */
  powerM: number | null;
};

/**
 * How much stronger the conductor is than the VIP, relative to the VIP.
 * `(conductor − vip) / vip`. Null when either power is missing or VIP power is 0.
 */
export function conductorToVipPowerDelta(
  conductorPowerM: number | null,
  vipPowerM: number | null,
): number | null {
  if (
    conductorPowerM == null ||
    vipPowerM == null ||
    !Number.isFinite(conductorPowerM) ||
    !Number.isFinite(vipPowerM) ||
    vipPowerM <= 0
  ) {
    return null;
  }
  return (conductorPowerM - vipPowerM) / vipPowerM;
}

const INVITE_ROLE_TOKEN =
  /\{conductorToVipPowerDelta\s*>\s*0\.1\s*\?\s*'([^']*)'\s*:\s*'([^']*)'\s*\}/g;

/**
 * Fill the officer's invite template.
 * `{conductor.commander.nickname}` and `{vip.commander.name}` are the spun people.
 * The power ternary becomes its defender word when the conductor is more than 10%
 * stronger than the VIP, and its guest word otherwise (including missing power).
 */
export function renderConductorInviteTemplate(
  template: string,
  input: {
    conductorNickname: string;
    vipName: string;
    conductorPowerM: number | null;
    vipPowerM: number | null;
  },
): string {
  const delta = conductorToVipPowerDelta(
    input.conductorPowerM,
    input.vipPowerM,
  );
  const defender = delta != null && delta > 0.1;
  return template
    .replaceAll("{conductor.commander.nickname}", input.conductorNickname)
    .replaceAll("{vip.commander.name}", input.vipName)
    .replace(INVITE_ROLE_TOKEN, (_match, defenderWord: string, guestWord: string) =>
      defender ? defenderWord : guestWord,
    );
}

/**
 * Date the trains hub opens on when the URL does not name one.
 * An explicit `?date=` always wins. Otherwise, when lead time is at least one
 * day, today already has a locked conductor, and that lock is more than 8 hours
 * old, open server tomorrow.
 */
export function defaultTrainsHubDate(input: {
  today: string;
  leadDays: number;
  explicitDate: string | null;
  todayLockedAt: string | null;
  now: Date;
}): string {
  if (input.explicitDate) return input.explicitDate;
  if (input.leadDays < 1 || !input.todayLockedAt) return input.today;
  const lockedAt = Date.parse(input.todayLockedAt);
  if (!Number.isFinite(lockedAt)) return input.today;
  if (input.now.getTime() - lockedAt <= CONDUCTOR_LOCK_STALE_MS) {
    return input.today;
  }
  return addCalendarDays(input.today, 1);
}
