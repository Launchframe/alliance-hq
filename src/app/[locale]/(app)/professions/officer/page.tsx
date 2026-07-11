import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ProfessionsOfficerRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/professions?tab=officer`);
}
