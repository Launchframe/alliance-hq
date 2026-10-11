import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/app-origin", () => ({ resolveAppOrigin: () => "https://hq.test" }));

import {
  buildMaintainerAllianceCredentialEmail,
  buildOfficerAllianceCredentialEmail,
  type AllianceCredentialNoticeContext,
} from "./alliance-credential-expiry.server";

const ctx: AllianceCredentialNoticeContext = {
  allianceId: "UImgfbUYvI9hpTW0",
  allianceTag: "LFgo",
  allianceName: "Looking For Group",
  stage: "expired",
  expiresAt: new Date("2026-07-28T02:48:40Z"),
  officerCount: 3,
};

describe("buildOfficerAllianceCredentialEmail", () => {
  it("explains impact and next steps without mentioning platform staff", () => {
    const email = buildOfficerAllianceCredentialEmail(ctx);
    expect(email.subject).toBe("LFgo: Ashed alliance connection expired");
    expect(email.text).toContain("July 28, 2026");
    expect(email.text).toContain("https://hq.test/connect");
    expect(email.text).toContain("https://hq.test/settings/team");
    expect(`${email.text} ${email.html}`).not.toMatch(/maintainer|platform admin/i);
  });

  it("uses future tense for upcoming expiry", () => {
    const email = buildOfficerAllianceCredentialEmail({ ...ctx, stage: "upcoming" });
    expect(email.subject).toBe("LFgo: Ashed alliance connection expires July 28, 2026");
    expect(email.text).toContain("will pause");
  });

  it("renders in the recipient's preferred language with linked URLs", () => {
    const email = buildOfficerAllianceCredentialEmail(ctx, "pt-BR");
    expect(email.subject).toBe("LFgo: a conexão da aliança com o Ashed expirou");
    expect(email.text).toContain("28 de julho de 2026");
    expect(email.text).toContain("Como resolver:");
    expect(email.text).toContain("https://hq.test/connect");
    expect(email.html).toContain('<a href="https://hq.test/settings/team">');
    expect(`${email.text} ${email.html}`).not.toContain("__HQ_EMAIL_URL__");
  });
});

describe("buildMaintainerAllianceCredentialEmail", () => {
  it("identifies the alliance and officer reach", () => {
    const email = buildMaintainerAllianceCredentialEmail(ctx);
    expect(email.subject).toBe("[Alliance HQ] LFgo alliance Ashed token expired on July 28, 2026");
    expect(email.text).toContain("LFgo (Looking For Group)");
    expect(email.text).toContain("UImgfbUYvI9hpTW0");
    expect(email.text).toContain("Officers notified: 3");
  });
});
