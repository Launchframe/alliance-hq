"use client";

import { Link } from "@/i18n/navigation";
import {
  allianceSettingsPath,
  allianceTagPathSegment,
} from "@/lib/alliance/alliance-settings-path.shared";

type AllianceOption = {
  tag: string;
  name: string;
};

type Props = {
  alliances: AllianceOption[];
  activeTag: string;
  label: string;
};

export function AllianceSettingsSwitcher({
  alliances,
  activeTag,
  label,
}: Props) {
  if (alliances.length <= 1) {
    return null;
  }

  const activeNeedle = allianceTagPathSegment(activeTag);

  return (
    <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
      <h2 className="text-sm font-medium text-[#e6edf3]">{label}</h2>
      <ul className="mt-3 flex flex-col gap-2">
        {alliances.map((alliance) => {
          const isActive =
            allianceTagPathSegment(alliance.tag) === activeNeedle;
          return (
            <li key={alliance.tag}>
              {isActive ? (
                <span className="block rounded-lg bg-[#1f3d5c] px-3 py-2 text-sm font-medium text-[#58a6ff]">
                  {alliance.tag}
                  {alliance.name ? (
                    <span className="ml-2 font-normal text-[#8b949e]">
                      {alliance.name}
                    </span>
                  ) : null}
                </span>
              ) : (
                <Link
                  href={allianceSettingsPath(alliance.tag)}
                  className="block rounded-lg border border-[#30363d] px-3 py-2 text-sm text-[#e6edf3] hover:bg-[#21262d]"
                >
                  {alliance.tag}
                  {alliance.name ? (
                    <span className="ml-2 text-[#8b949e]">{alliance.name}</span>
                  ) : null}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
