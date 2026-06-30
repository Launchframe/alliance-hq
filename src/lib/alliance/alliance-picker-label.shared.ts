import type { SessionAllianceOption } from "@/lib/alliance/types";

export function alliancePickerOptionSearchText(
  alliance: SessionAllianceOption,
): string {
  const tag = alliance.tag ?? alliance.slug;
  const parts = [tag, alliance.name, alliance.slug];
  if (alliance.roleName) {
    parts.push(alliance.roleName);
  }
  return parts.filter(Boolean).join(" ");
}

export function alliancePickerOptionPlainLabel(
  alliance: SessionAllianceOption,
): string {
  const tag = alliance.tag ?? alliance.slug;
  const namePart =
    alliance.name && alliance.name !== tag ? ` — ${alliance.name}` : "";
  const rolePart = alliance.roleName ? ` (${alliance.roleName})` : "";
  return `${tag}${namePart}${rolePart}`;
}
