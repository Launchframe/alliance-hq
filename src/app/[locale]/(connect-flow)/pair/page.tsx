import { PairingLandingClient } from "@/components/credential-pairing/PairingLandingClient";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ code?: string }>;
};

export default async function PairPage({ searchParams }: Props) {
  const { code = "" } = await searchParams;

  return <PairingLandingClient code={code.trim()} />;
}
