import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

export async function GET() {
  try {
    const db = getDb();
    const commendations = await db
      .select()
      .from(schema.hqCommendations)
      .where(eq(schema.hqCommendations.active, 1))
      .orderBy(asc(schema.hqCommendations.sortOrder));

    return NextResponse.json({ commendations });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to list commendations",
      },
      { status: 500 },
    );
  }
}
