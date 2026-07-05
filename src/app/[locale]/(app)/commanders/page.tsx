import { getLocale } from "next-intl/server";

import { redirect } from "@/i18n/navigation";
import { requirePagePermission } from "@/lib/rbac/page-permission";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CommandersRedirectPage({
  searchParams,
}: PageProps) {
  const session = await requirePageSession("/commanders");
  await requirePagePermission(session.id, "members:read", "/commanders");
  const locale = await getLocale();
  const params = await searchParams;
  const qs = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") {
      qs.set(key, value);
    } else if (Array.isArray(value)) {
      for (const entry of value) {
        qs.append(key, entry);
      }
    }
  }

  const query = qs.toString();
  redirect({
    href: query ? `/members?${query}` : "/members",
    locale,
  });
}
