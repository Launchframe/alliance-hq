import { NextResponse } from "next/server";

import { isDevOrPreviewEnvironment } from "@/lib/dev/env-guard";
import { loadVsFixtureById } from "@/lib/video/vs-fixture-library.server";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/** GET /api/dev/vs-score-fixtures/:id/export — download template JSON for commit. */
export async function GET(
  _request: Request,
  { params }: Props,
): Promise<NextResponse> {
  if (!isDevOrPreviewEnvironment()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { id } = await params;
  const template = await loadVsFixtureById(id);

  if (!template) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return new NextResponse(JSON.stringify(template, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${template.id}.json"`,
    },
  });
}
