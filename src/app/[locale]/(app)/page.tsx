import { redirect } from "@/i18n/navigation";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  redirect({ href: "/dashboard", locale });
}
