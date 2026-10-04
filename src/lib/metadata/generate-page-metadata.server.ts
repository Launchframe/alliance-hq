import type { Metadata } from "next";
import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { loadSession, readSessionId } from "@/lib/session";

import {
  formatContextAwarePageTitle,
  formatVideoJobPageTitle,
} from "./page-title.shared";

async function resolveAllianceTagForMetadata(
  urlTag?: string | null,
): Promise<string | null> {
  if (urlTag?.trim()) {
    return urlTag.trim();
  }

  const sessionId = await readSessionId();
  if (!sessionId) {
    return null;
  }

  const session = await loadSession(sessionId);
  if (!session) {
    return null;
  }

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (allianceId) {
    const db = getDb();
    const [row] = await db
      .select({ tag: schema.alliances.tag })
      .from(schema.alliances)
      .where(eq(schema.alliances.id, allianceId))
      .limit(1);
    if (row?.tag?.trim()) {
      return row.tag.trim();
    }
  }

  return session.allianceTag?.trim() ?? null;
}

export async function allianceScopedPageTitle(
  pageTitle: string,
  options?: { urlTag?: string | null },
): Promise<string> {
  const tag = await resolveAllianceTagForMetadata(options?.urlTag);
  return formatContextAwarePageTitle(pageTitle, { allianceTag: tag });
}

export async function allianceScopedMetadata(
  pageTitle: string,
  options?: { urlTag?: string | null },
): Promise<Metadata> {
  return { title: await allianceScopedPageTitle(pageTitle, options) };
}

export function adminScopedPageTitle(pageTitle: string): string {
  return formatContextAwarePageTitle(pageTitle, { admin: true });
}

export function adminScopedMetadata(pageTitle: string): Metadata {
  return { title: adminScopedPageTitle(pageTitle) };
}

export function standalonePageMetadata(pageTitle: string): Metadata {
  return { title: pageTitle.trim() };
}

export function videoJobPageMetadata(
  jobLabel: string,
  options?: { fileName?: string | null },
): Metadata {
  const label = options?.fileName?.trim() || jobLabel.trim();
  return { title: formatVideoJobPageTitle(label) };
}

export async function videoJobMetadataForJobId(
  jobId: string,
): Promise<Metadata> {
  const trimmedJobId = jobId.trim();
  if (!trimmedJobId) {
    return videoJobPageMetadata("");
  }

  const db = getDb();
  const [row] = await db
    .select({
      id: schema.videoJobs.id,
      fileName: schema.videoJobs.fileName,
    })
    .from(schema.videoJobs)
    .where(eq(schema.videoJobs.id, trimmedJobId))
    .limit(1);

  if (!row) {
    return videoJobPageMetadata(trimmedJobId);
  }

  return videoJobPageMetadata(row.id, { fileName: row.fileName });
}
