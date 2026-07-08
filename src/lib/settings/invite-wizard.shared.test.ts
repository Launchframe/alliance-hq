import { describe, expect, it } from "vitest";

import {
  defaultInviteWizardTargets,
  isValidInviteEmail,
  JOIN_CODE_DEFAULT_MAX_USES,
} from "@/lib/settings/invite-wizard.shared";
import { validateInviteWizardStep2 } from "@/lib/settings/invite-wizard-generate.client";

describe("invite wizard shared", () => {
  it("defaults member join code max uses to 90", () => {
    const targets = defaultInviteWizardTargets(["member", "officer"]);
    expect(targets.joinCodeMaxUses).toBe(
      String(JOIN_CODE_DEFAULT_MAX_USES.member),
    );
  });

  it("validates invite email on email-bound invites", () => {
    expect(isValidInviteEmail("a@b.co")).toBe(true);
    expect(isValidInviteEmail("not-an-email")).toBe(false);

    const targets = defaultInviteWizardTargets(["officer"]);
    targets.inviteLinkSubtype = "email";
    targets.inviteEmail = "bad";
    targets.inviteRole = "officer";

    expect(
      validateInviteWizardStep2({ type: "invite_link", targets }),
    ).toBe("inviteEmailRequired");
  });
});
