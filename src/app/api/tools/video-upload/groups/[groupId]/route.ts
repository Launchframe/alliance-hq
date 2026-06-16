import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getOrCreateSession } from "@/lib/session";

type Props = { params: Promise<{ groupId: string }> };

export async function PATCH(request: Request, { params }: Props) {
  try {
    const session = await getOrCreateSession();
    const { groupId } = await params;
    const body = (await request.json()) as {
      selectedJobId?: string;
      accuracyJobId?: string;
    };

    const db = getDb();

    const [group] = await db
      .select({ id: schema.videoUploadGroups.id })
      .from(schema.videoUploadGroups)
      .where(
        and(
          eq(schema.videoUploadGroups.id, groupId),
          eq(schema.videoUploadGroups.sessionId, session.id),
        ),
      )
      .limit(1);

    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof body.selectedJobId === "string") patch.selectedJobId = body.selectedJobId;
    if (typeof body.accuracyJobId === "string") patch.accuracyJobId = body.accuracyJobId;

    await db
      .update(schema.videoUploadGroups)
      .set(patch)
      .where(eq(schema.videoUploadGroups.id, groupId));

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Update failed" },
      { status: 500 },
    );
  }
}
