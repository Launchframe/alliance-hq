import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/bff/audit", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

const dbMocks = vi.hoisted(() => ({
  update: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    update: dbMocks.update,
    select: dbMocks.select,
  }),
  schema: {
    hqMemberOnboardingReviews: {
      id: "id",
      allianceId: "alliance_id",
      status: "status",
    },
    allianceMembers: {},
    hqUsers: {},
  },
}));

vi.mock("@/lib/member-link/onboarding-review-inbox.server", () => ({
  satisfyOnboardingReviewInboxItem: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/member-link/merge-commander.server", () => ({
  mergeSelfServiceMemberIntoRosterTarget: vi.fn(),
}));

vi.mock("@/lib/member-link/self-service-onboarding.server", () => ({
  loadAllianceMemberOnboardingRow: vi.fn(),
}));

vi.mock("@/lib/rbac/context", () => ({
  getRbacContext: vi.fn(),
}));

const audit = await import("@/lib/bff/audit");
const inbox = await import("@/lib/member-link/onboarding-review-inbox.server");
const { approveOnboardingReview, dismissOnboardingReview } = await import(
  "@/lib/member-link/onboarding-review.server"
);

const pendingReview = {
  id: "rev1",
  allianceId: "ally1",
  hqUserId: "member-hq",
  status: "pending",
  gameUserName: "CommanderOne",
  linkedAshedMemberId: "m1",
  origin: "web",
  gameUid: "12345678901234",
};

function mockReviewLookup() {
  dbMocks.select.mockReturnValue({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve([pendingReview]),
      }),
    }),
  });
}

function mockReviewUpdate() {
  dbMocks.update.mockReturnValue({
    set: () => ({
      where: () => Promise.resolve(undefined),
    }),
  });
}

describe("onboarding-review.server audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReviewLookup();
    mockReviewUpdate();
  });

  it("audits approve with the resolving officer", async () => {
    const result = await approveOnboardingReview({
      reviewId: "rev1",
      allianceId: "ally1",
      resolvedByHqUserId: "officer-hq",
      sessionId: "sess1",
    });

    expect(result).toEqual({ ok: true });
    expect(inbox.satisfyOnboardingReviewInboxItem).toHaveBeenCalledWith("rev1");
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess1",
        hqUserId: "officer-hq",
        allianceId: "ally1",
        action: "member_link.onboarding_review_approved",
        resourceType: "hq_member_onboarding_review",
        resourceId: "rev1",
        metadata: expect.objectContaining({
          reviewId: "rev1",
          status: "approved",
          gameUserName: "CommanderOne",
          requesterHqUserId: "member-hq",
        }),
      }),
    );
  });

  it("audits dismiss with the resolving officer", async () => {
    const result = await dismissOnboardingReview({
      reviewId: "rev1",
      allianceId: "ally1",
      resolvedByHqUserId: "officer-hq",
      sessionId: "sess1",
    });

    expect(result).toEqual({ ok: true });
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "member_link.onboarding_review_dismissed",
        hqUserId: "officer-hq",
      }),
    );
  });
});
