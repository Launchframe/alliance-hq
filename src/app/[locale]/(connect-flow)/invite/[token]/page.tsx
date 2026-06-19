import { InviteAcceptClient } from "@/components/native-alliance/InviteAcceptClient";

export const dynamic = "force-dynamic";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string; locale: string }>;
}) {
  const { token } = await params;
  return <InviteAcceptClient token={token} />;
}
