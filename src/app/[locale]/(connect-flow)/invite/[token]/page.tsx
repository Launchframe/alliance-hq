import { InviteAcceptClient } from "@/components/native-alliance/InviteAcceptClient";

export const dynamic = "force-dynamic";

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string; locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { token } = await params;
  const { next } = await searchParams;
  return <InviteAcceptClient token={token} queryRedirect={next} />;
}
