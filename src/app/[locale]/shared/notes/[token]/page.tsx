import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getPublicSnapshot } from "@/lib/notes/publications.server";
import { NoteMarkdown } from "@/components/notes/NoteMarkdown";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export async function generateMetadata() {
  const t = await getTranslations("notes.publications");
  return { title: t("sharedTitle"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}
export default async function SharedNotePage({ params }: { params: Promise<{ token: string }> }) {
  const snapshot = await getPublicSnapshot((await params).token);
  if (!snapshot) notFound();
  const t = await getTranslations({ locale: snapshot.locale, namespace: "notes.publications" });
  return <main data-testid="public-note" className="mx-auto max-w-3xl space-y-6 px-6 py-10"><h1 className="text-3xl font-semibold">{snapshot.title}</h1><NoteMarkdown body={snapshot.body} allowLinks={false} /><footer className="border-t border-hq-border pt-4 text-xs text-hq-fg-muted">{t("version", { version: snapshot.version })} · {t("expires", { date: new Intl.DateTimeFormat(snapshot.locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(snapshot.expiresAt)) })}</footer></main>;
}
