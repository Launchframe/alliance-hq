export const DISCORD_MEMBER_LINK_TAG = "_member_link";

export function memberLinkReplaceAllFromNonceTag(tag: string): boolean {
  return tag === `${DISCORD_MEMBER_LINK_TAG}:replace`;
}
