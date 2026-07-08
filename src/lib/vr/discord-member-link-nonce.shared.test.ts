import { describe, expect, it } from "vitest";

import {
  DISCORD_MEMBER_LINK_TAG,
  memberLinkReplaceAllFromNonceTag,
} from "@/lib/vr/discord-member-link-nonce.shared";

describe("memberLinkReplaceAllFromNonceTag", () => {
  it("detects replace-all encoding on member_link nonce tags", () => {
    expect(memberLinkReplaceAllFromNonceTag(DISCORD_MEMBER_LINK_TAG)).toBe(false);
    expect(memberLinkReplaceAllFromNonceTag(`${DISCORD_MEMBER_LINK_TAG}:replace`)).toBe(
      true,
    );
  });
});
