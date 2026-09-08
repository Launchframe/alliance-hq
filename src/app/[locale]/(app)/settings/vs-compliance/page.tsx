import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { requireAuthForPage } from "@/lib/auth/page-guard";

export const dynamic = "force-dynamic";

export default async function LegacyVsComplianceSettingsPage() {
  await requireAuthForPage("/settings/vs-membership-minimums");
  redirect({ href: "/settings/vs-membership-minimums", locale: await getLocale() });
}
