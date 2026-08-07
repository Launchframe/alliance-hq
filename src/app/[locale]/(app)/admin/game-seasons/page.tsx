import { AdminGameSeasonsConsole } from "@/components/admin/AdminGameSeasonsConsole";
import { adminScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return adminScopedMetadata(t("nav.gameSeasons"));
}
export default function AdminGameSeasonsPage() {
  return <AdminGameSeasonsConsole />;
}
