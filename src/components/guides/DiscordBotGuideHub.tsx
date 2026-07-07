"use client";

import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import {
  DISCORD_BOT_GUIDE_ROLE_SLUGS,
  type DiscordBotGuideRoleSlug,
} from "@/lib/guides/discord-bot-guide.shared";
const ROLE_ACCENT: Record<DiscordBotGuideRoleSlug, string> = {
  r5: "border-[#d4a017]/40 bg-[#d4a017]/10 hover:border-[#d4a017]/70",
  r4: "border-hq-accent/40 bg-hq-accent/10 hover:border-hq-accent/70",
  member: "border-hq-green/40 bg-hq-green/10 hover:border-hq-green/70",
  "link-only":
    "border-[#bc8cff]/40 bg-[#bc8cff]/10 hover:border-[#bc8cff]/70",
};

export function DiscordBotGuideHub() {
  const t = useTranslations("guides.discordBot");

  return (
    <div className="mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-10 pb-12">
      <header className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {t("hub.title")}
        </h1>
        <p className="text-sm leading-relaxed text-hq-fg-muted sm:text-base">
          {t("hub.subtitle")}
        </p>
      </header>

      <section className="rounded-xl border border-[#d4a017]/30 bg-[#d4a017]/10 p-5 sm:p-6">
        <p className="text-sm leading-relaxed text-hq-fg">
          {t.rich("hub.r5Callout", {
            link: (chunks) => (
              <Link href="/guides/getting-started" className="text-hq-accent hover:underline">
                {chunks}
              </Link>
            ),
          })}
        </p>
      </section>

      <section className="space-y-3 rounded-xl border border-hq-border bg-hq-surface p-5 sm:p-6">
        <h2 className="text-lg font-medium">{t("hub.overviewTitle")}</h2>
        <p className="text-sm leading-relaxed text-hq-fg-muted">
          {t("hub.overviewBody")}
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t("hub.prerequisitesTitle")}</h2>
        <p className="whitespace-pre-line text-sm leading-relaxed text-hq-fg-muted">
          {t("hub.prerequisitesBody")}
        </p>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-medium">{t("hub.rolePrompt")}</h2>
          <p className="mt-1 text-sm text-hq-fg-muted">{t("hub.pickRole")}</p>
        </div>

        <ul className="grid min-w-0 gap-3 sm:grid-cols-2">
          {DISCORD_BOT_GUIDE_ROLE_SLUGS.map((role) => (
            <li key={role} className="min-w-0">
              <Link
                href={`/guides/discord-bot/${role}`}
                className={`group flex min-h-full min-w-0 flex-col gap-2 rounded-xl border p-4 transition-colors ${ROLE_ACCENT[role]}`}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="font-medium leading-snug">
                    {t(`roles.${role}.title`)}
                  </span>
                  <ChevronRight
                    className="mt-0.5 h-4 w-4 shrink-0 text-hq-fg-muted transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </span>
                <span className="text-sm leading-relaxed text-hq-fg-muted">
                  {t(`roles.${role}.description`)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
