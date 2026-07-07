"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import {
  DEFAULT_POST_INVITE_APP_PATH,
  sanitizeInternalRedirectPath,
} from "@/lib/navigation/safe-redirect.shared";

type Props = {
  onConnectAshed: () => void;
};

export function InviteWelcomeClient({ onConnectAshed }: Props) {
  const t = useTranslations("invite.welcome");
  const searchParams = useSearchParams();
  const nextPath =
    sanitizeInternalRedirectPath(searchParams.get("next")) ??
    DEFAULT_POST_INVITE_APP_PATH;

  return (
    <div className="mx-auto max-w-lg space-y-5 rounded-xl border border-hq-border bg-hq-surface p-6">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-hq-fg-muted">{t("body")}</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onConnectAshed}
          className="w-full rounded-lg border border-hq-success bg-hq-success px-4 py-2.5 text-sm font-medium text-white sm:flex-1"
        >
          {t("connectAshed")}
        </button>
        <Link
          href={nextPath}
          className="inline-flex w-full items-center justify-center rounded-lg border border-hq-border bg-hq-canvas px-4 py-2.5 text-sm font-medium text-hq-fg hover:bg-hq-surface sm:flex-1"
        >
          {t("nativeOnly")}
        </Link>
      </div>
    </div>
  );
}
