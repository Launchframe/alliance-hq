import { AshedEmbed } from "@/components/AshedEmbed";
import { notFound } from "next/navigation";

type Props = {
  params: Promise<{ path?: string[] }>;
};

export default async function AshedPage({ params }: Props) {
  const { path = [] } = await params;
  if (path.length === 0) {
    notFound();
  }

  const ashedPath = `/${path.join("/")}`;

  return <AshedEmbed path={ashedPath} />;
}
