import { getTranslations } from "next-intl/server";

export default async function UnavailableSharedNote() {
  const t = await getTranslations("notes.publications");
  return <main className="mx-auto max-w-3xl px-6 py-12"><h1 className="text-xl font-semibold">{t("unavailable")}</h1></main>;
}
