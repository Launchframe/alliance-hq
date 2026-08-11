import { getTranslations } from "next-intl/server";

import { adminScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";

import AdminHqEventsPageClient from "./AdminHqEventsPageClient";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return adminScopedMetadata(t("hqEventsTitle"));
}

export default function AdminHqEventsPage() {
  return <AdminHqEventsPageClient />;
}
