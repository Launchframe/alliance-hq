import { randomUUID } from "node:crypto";

import { eq, inArray, or } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next-intl/server", () => ({ getTranslations: vi.fn(async () => (key: string) => key) }));
vi.mock("@/lib/officer-intel/embed-corpus.server", () => ({
  knowledgeEmbeddingModel: () => "test-embed",
  knowledgeEmbeddingConfigured: () => true,
  embedKnowledgeTexts: vi.fn(),
}));

import { mergeHqUsersIntoCanonical } from "@/lib/auth/merge-hq-users.server";
import { getDb, resetDbPool, schema } from "@/lib/db";

import { assertE2eDatabaseUrl } from "../../../scripts/e2e-database-url-guard.mjs";
import { getKnowledgeActorForGenerationJob } from "./access.server";
import { knowledgeJobMatches } from "./knowledge-index.server";

const enabled = process.env.KNOWLEDGE_DB_TEST === "1";
const PREFIX = "knowledge-merge-test";

describe.skipIf(!enabled)("account merge knowledge remap (DB)", () => {
  const userIds: string[] = [];
  const allianceIds: string[] = [];
  const resourceIds: string[] = [];
  const indexJobIds: string[] = [];
  const generationJobIds: string[] = [];
  const sessionIds: string[] = [];

  beforeAll(() => {
    const urls = [process.env.DATABASE_URL, process.env.LOCAL_DATABASE_URL, process.env.E2E_DATABASE_URL]
      .filter((url): url is string => typeof url === "string" && url.length > 0);
    if (urls.length !== 3 || new Set(urls).size !== 1) throw new Error("Knowledge merge integration requires one guarded database.");
    for (const url of urls) assertE2eDatabaseUrl(url);
  });

  afterEach(async () => {
    const db = getDb();
    if (generationJobIds.length) await db.delete(schema.knowledgeGenerationJobs).where(inArray(schema.knowledgeGenerationJobs.id, generationJobIds.splice(0)));
    if (indexJobIds.length) await db.delete(schema.knowledgeIndexJobs).where(inArray(schema.knowledgeIndexJobs.id, indexJobIds.splice(0)));
    if (resourceIds.length) await db.delete(schema.knowledgeResources).where(inArray(schema.knowledgeResources.id, resourceIds.splice(0)));
    if (sessionIds.length) await db.delete(schema.sessions).where(inArray(schema.sessions.id, sessionIds.splice(0)));
    if (userIds.length) {
      await db.delete(schema.activityOwnershipAliases).where(or(
        inArray(schema.activityOwnershipAliases.originalHqUserId, userIds),
        inArray(schema.activityOwnershipAliases.personalOwnerHqUserId, userIds),
      ));
      await db.delete(schema.hqUsers).where(inArray(schema.hqUsers.id, userIds.splice(0)));
    }
    if (allianceIds.length) await db.delete(schema.alliances).where(inArray(schema.alliances.id, allianceIds.splice(0)));
  });

  afterAll(async () => {
    await resetDbPool();
  });

  async function user() {
    const id = `${PREFIX}-user-${randomUUID()}`;
    userIds.push(id);
    await getDb().insert(schema.hqUsers).values({ id, email: `${id}@e2e.test`, displayName: "Knowledge merge test" });
    return id;
  }

  async function alliance() {
    const id = `${PREFIX}-alliance-${randomUUID()}`;
    allianceIds.push(id);
    await getDb().insert(schema.alliances).values({ id, slug: id, name: "Knowledge merge test", gameServerId: "server-1203", gameServerNumber: 1203 });
    return id;
  }

  async function resource(allianceId: string, ownerHqUserId: string, kind: "note" | "draft" = "note", consented = false) {
    const id = `${PREFIX}-resource-${randomUUID()}`;
    resourceIds.push(id);
    await getDb().insert(schema.knowledgeResources).values({
      id, allianceId, kind, entityId: id, ownershipState: "hq", ownerHqUserId,
      ...(consented ? { knowledgeAiAllowed: true, knowledgeApprovedVersion: 1, knowledgeApprovalVersion: 1, knowledgeConsentVersion: 1 } : {}),
    });
    const [row] = await getDb().select().from(schema.knowledgeResources).where(eq(schema.knowledgeResources.id, id));
    return row;
  }

  async function indexJob(row: typeof schema.knowledgeResources.$inferSelect, state: "completed" | "pending", model = "test-embed") {
    const id = `${PREFIX}-index-${randomUUID()}`;
    indexJobIds.push(id);
    await getDb().insert(schema.knowledgeIndexJobs).values({
      id, allianceId: row.allianceId, resourceId: row.id, ownerHqUserId: row.ownerHqUserId!, model, state,
      contentVersion: row.contentVersion, accessVersion: row.accessVersion, approvalVersion: row.knowledgeApprovalVersion, consentVersion: row.knowledgeConsentVersion,
    });
    return id;
  }

  async function grant(row: typeof schema.knowledgeResources.$inferSelect, subjectId: string, role: "read" | "edit") {
    await getDb().insert(schema.knowledgeResourceGrants).values({ id: `${PREFIX}-grant-${randomUUID()}`, resourceId: row.id, allianceId: row.allianceId, subjectKind: "user", subjectId, role });
  }

  async function merge(sourceHqUserId: string, canonicalHqUserId: string) {
    await getDb().insert(schema.hqAuthAccounts).values({ id: `${PREFIX}-auth-${randomUUID()}`, hqUserId: sourceHqUserId, type: "oauth", provider: PREFIX, providerAccountId: randomUUID() });
    await mergeHqUsersIntoCanonical({ canonicalHqUserId, sourceHqUserId });
  }

  async function load(id: string) {
    const [row] = await getDb().select().from(schema.knowledgeResources).where(eq(schema.knowledgeResources.id, id));
    return row;
  }

  it("moves ownership, grants, jobs, and AI usage onto the canonical user without bumping access lineage", async () => {
    const [source, canonical, other, allianceId] = [await user(), await user(), await user(), await alliance()];
    const owned = await resource(allianceId, source);
    const sharedBoth = await resource(allianceId, other);
    await grant(sharedBoth, source, "edit");
    await grant(sharedBoth, canonical, "read");
    const sharedSource = await resource(allianceId, other);
    await grant(sharedSource, source, "read");
    const completed = await indexJob(owned, "completed");
    await getDb().insert(schema.knowledgeAiUsage).values({ id: `${PREFIX}-usage-${randomUUID()}`, allianceId, principalKey: `hq:${source}`, operation: "query", inputChars: 10 });

    await merge(source, canonical);

    const after = await load(owned.id);
    expect(after.ownerHqUserId).toBe(canonical);
    expect(after.accessVersion).toBe(owned.accessVersion);
    expect(after.version).toBe(owned.version);
    expect((await load(sharedBoth.id)).accessVersion).toBe(sharedBoth.accessVersion);
    expect((await load(sharedSource.id)).accessVersion).toBe(sharedSource.accessVersion);

    const grants = await getDb().select({ resourceId: schema.knowledgeResourceGrants.resourceId, subjectId: schema.knowledgeResourceGrants.subjectId, role: schema.knowledgeResourceGrants.role })
      .from(schema.knowledgeResourceGrants).where(inArray(schema.knowledgeResourceGrants.resourceId, [sharedBoth.id, sharedSource.id]));
    expect(grants).toEqual(expect.arrayContaining([
      { resourceId: sharedBoth.id, subjectId: canonical, role: "edit" },
      { resourceId: sharedSource.id, subjectId: canonical, role: "read" },
    ]));
    expect(grants).toHaveLength(2);

    const [job] = await getDb().select().from(schema.knowledgeIndexJobs).where(eq(schema.knowledgeIndexJobs.id, completed));
    expect(job.ownerHqUserId).toBe(canonical);
    expect(job.state).toBe("completed");

    const usage = await getDb().select({ principalKey: schema.knowledgeAiUsage.principalKey }).from(schema.knowledgeAiUsage).where(eq(schema.knowledgeAiUsage.allianceId, allianceId));
    expect(usage).toEqual([{ principalKey: `hq:${canonical}` }]);
  });

  it("revokes AI consent on owner change, so a completed index no longer serves retrieval after merge", async () => {
    const [source, canonical, allianceId] = [await user(), await user(), await alliance()];
    const owned = await resource(allianceId, source, "note", true);
    const completed = await indexJob(owned, "completed");
    const pending = await indexJob(owned, "pending", "test-embed-pending");
    const [beforeJob] = await getDb().select().from(schema.knowledgeIndexJobs).where(eq(schema.knowledgeIndexJobs.id, completed));
    expect(knowledgeJobMatches(beforeJob, owned)).toBe(true);

    await merge(source, canonical);

    // The knowledge_consent_revision trigger (migration 0169) treats any owner change as a
    // new owner who has not consented: AI permission and approval are cleared and the
    // consent version advances. Retrieval therefore fails closed until the owner re-consents.
    const after = await load(owned.id);
    expect(after.knowledgeAiAllowed).toBe(false);
    expect(after.knowledgeApprovedVersion).toBeNull();
    expect(after.knowledgeConsentVersion).toBe(owned.knowledgeConsentVersion + 1);
    const jobs = await getDb().select().from(schema.knowledgeIndexJobs).where(inArray(schema.knowledgeIndexJobs.id, [completed, pending]));
    const byId = new Map(jobs.map((job) => [job.id, job]));
    expect(byId.get(completed)!.ownerHqUserId).toBe(canonical);
    expect(knowledgeJobMatches(byId.get(completed)!, after)).toBe(false);
    expect(byId.get(pending)!.state).toBe("cancelled");
  });

  it("fails closed for an in-flight generation job bound to a merged-away session", async () => {
    const [source, canonical, allianceId] = [await user(), await user(), await alliance()];
    const draft = await resource(allianceId, source, "draft");
    const sessionId = `${PREFIX}-session-${randomUUID()}`;
    sessionIds.push(sessionId);
    await getDb().insert(schema.sessions).values({ id: sessionId, hqUserId: source, currentAllianceId: allianceId, expiresAt: new Date(Date.now() + 3_600_000) });
    const jobId = `${PREFIX}-generation-${randomUUID()}`;
    generationJobIds.push(jobId);
    await getDb().insert(schema.knowledgeGenerationJobs).values({
      id: jobId, allianceId, resourceId: draft.id, requesterId: source, sessionId,
      kind: "ask", locale: "en-US", model: "test-generate", evidence: [], inputIds: [],
    });

    await merge(source, canonical);

    const [job] = await getDb().select().from(schema.knowledgeGenerationJobs).where(eq(schema.knowledgeGenerationJobs.id, jobId));
    expect(job.requesterId).toBe(canonical);
    expect(job.sessionId).toBe(sessionId);
    const sessions = await getDb().select({ id: schema.sessions.id }).from(schema.sessions).where(eq(schema.sessions.id, sessionId));
    expect(sessions).toEqual([]);
    await expect(getKnowledgeActorForGenerationJob(jobId)).resolves.toBeNull();
  });
});
