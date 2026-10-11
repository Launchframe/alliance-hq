"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type Props = {
  children: React.ReactNode;
};

export function AdminPortalShell({ children }: Props) {
  const pathname = usePathname();
  const t = useTranslations("admin");

  // Video jobs tables are wide (many columns); give that section ~50% more room
  // than the default admin shell without widening every admin page.
  const wideContent = pathname.startsWith("/admin/video-jobs");

  return (
    <div
      className={cn(
        "mx-auto w-full min-w-0 space-y-4 md:space-y-6",
        wideContent ? "max-w-[108rem]" : "max-w-6xl",
      )}
    >
      <div>
        <h1 className="text-xl font-semibold lg:text-2xl">{t("title")}</h1>
        <p className="mt-1 text-sm text-hq-fg-muted">{t("subtitle")}</p>
      </div>
      {children}
    </div>
  );
}
