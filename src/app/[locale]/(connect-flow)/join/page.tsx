import { JoinCodeClient } from "@/components/auth/JoinCodeClient";
import { requireAuthForPage } from "@/lib/auth/page-guard";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ code?: string }>;
};

export default async function JoinPage({ searchParams }: Props) {
  await requireAuthForPage("/join");
  const { code } = await searchParams;
  return <JoinCodeClient initialCode={code?.trim()} />;
}
