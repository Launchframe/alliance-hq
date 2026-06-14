import { AshedEmbed } from "@/components/AshedEmbed";
import { resolveAshedPath, resolveIframePage } from "@/lib/nav/routes";
import { notFound } from "next/navigation";

type Props = {
  params: Promise<{ page: string }>;
};

export default async function IframeNavPage({ params }: Props) {
  const { page } = await params;
  const route = resolveIframePage(page);
  const ashedPath = route ? resolveAshedPath(route) : undefined;
  if (!route || !ashedPath) {
    notFound();
  }

  return (
    <AshedEmbed path={ashedPath} labelKey={route.labelKey} />
  );
}
