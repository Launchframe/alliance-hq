import { getTranslations } from "next-intl/server";

import { adminScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";

import AdminOpsInboxPageClient from "./AdminOpsInboxPageClient";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return adminScopedMetadata(t("opsInbox.title"));
}

export default function AdminOpsInboxPage() {
  return <AdminOpsInboxPageClient />;
}
