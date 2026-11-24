import { describe, expect, it } from "vitest";

import { buildCredentialShareExpiredEmail } from "@/lib/ashed/credential-share-email.server";
import { buildAuthCodeEmail } from "@/lib/auth/auth-code-email.server";
import { buildMagicLinkEmail } from "@/lib/auth/magic-link-email.server";
import { buildBankDropEmail } from "@/lib/banks/drop-notifications.server";
import type { BankDropSummary } from "@/lib/banks/drop-summary.shared";
import {
  buildRosterLinkInviteeAcceptedEmail,
  buildRosterLinkOwnerEmail,
} from "@/lib/member-link/roster-link-owner-email.server";

describe("localized notification emails", () => {
  it("keeps the existing English verification code email", () => {
    const email = buildAuthCodeEmail("verify", "123456", "en-US");
    expect(email.subject).toBe("123456 is your Alliance HQ verification code");
    expect(email.text).toBe(
      "Your Alliance HQ verification code is 123456. It expires in 10 minutes.",
    );
    expect(email.html).toContain("Verify your email");
  });

  it("renders verification codes in the recipient's language", () => {
    const email = buildAuthCodeEmail("merge", "654321", "pt-BR");
    expect(email.subject).toBe("654321 é seu código de mesclagem de conta do Alliance HQ");
    expect(email.html).toContain("Confirme a mesclagem de contas");
  });

  it("renders the magic link email in the recipient's language", () => {
    const email = buildMagicLinkEmail({
      url: "https://hq.test/api/auth/callback?token=x",
      theme: {},
      locale: "id",
    });
    expect(email.subject).toBe("Masuk ke hq.test");
    expect(email.html).toContain("<strong>hq&#8203;.test</strong>");
    expect(email.html).toContain(">Masuk</a>");
  });

  it("escapes player names in localized roster link approval emails", () => {
    const email = buildRosterLinkOwnerEmail(
      {
        allianceTag: "LFgo",
        gameUserName: "<b>Mew</b>",
        reportedName: "Mew",
        gameUid: "1",
        gameServerNumber: 1203,
        requestId: "req-1",
        rejectToken: "t",
      },
      "pt-BR",
    );
    expect(email.text).toContain("servidor 1203");
    expect(email.html).toContain("&lt;b&gt;Mew&lt;/b&gt;");
    expect(email.html).toContain("Revisar no Alliance HQ");
  });

  it("bolds the alliance tag inside translated roster link copy", () => {
    const email = buildRosterLinkInviteeAcceptedEmail(
      { allianceTag: "A&B", onboardUrl: "https://hq.test/onboard" },
      "pt-BR",
    );
    expect(email.html).toContain("<strong>A&amp;B</strong>");
    expect(email.text).toContain("Volte ao Alliance HQ");
  });

  it("localizes credential share end reasons", () => {
    const email = buildCredentialShareExpiredEmail(
      { allianceTag: "LFgo", endReason: "membership_ended", recipientRole: "delegate" },
      "pt-BR",
    );
    expect(email.text).toContain("um oficial saiu da aliança");
  });

  it("formats bank drop amounts for the recipient's locale", () => {
    const summary = {
      bank: { level: 3, coordX: 120, coordY: 455 },
      durationLabel: "2d 4h",
      totalDeposits: 12,
      totalCrystalGoldDeposited: 1234567,
      totalInterestEarned: 4500,
      investmentReturnPercent: 3.6,
      crystalGoldLooted: 0,
      slippagePercent: 0,
      lockedCount: 0,
      lockedValue: 0,
    } as unknown as BankDropSummary;
    const en = buildBankDropEmail(summary, "en-US");
    expect(en.subject).toBe("Bank Dropped: Lv3 (120, 455) — 2d 4h");
    expect(en.text).toContain("Deposits processed: 12 totaling 1,234,567 CG");
    const pt = buildBankDropEmail(summary, "pt-BR");
    expect(pt.text).toContain("Depósitos processados: 12 totalizando 1.234.567 CG");
  });
});
