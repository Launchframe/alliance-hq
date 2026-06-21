import { nanoid } from "nanoid";

import type { Sql } from "./db";
import {
  acceptInviteViaApi,
  createAshedAlliance,
  createHqInviteRow,
  createNativeAlliance,
  createPlatformMaintainerSession,
  type SessionFixture,
} from "./db";

export type ViewOnlyMemberFixture = SessionFixture & {
  allianceId: string;
  tag: string;
};

export async function createViewOnlyMember(
  sql: Sql,
  baseURL: string,
  options: {
    operatingMode: "native" | "ashed";
    roleName?: "member" | "viewer";
  },
): Promise<ViewOnlyMemberFixture> {
  const maintainer = await createPlatformMaintainerSession(sql);
  const createAlliance =
    options.operatingMode === "native"
      ? createNativeAlliance
      : createAshedAlliance;
  const alliance = await createAlliance(sql, {
    tag: `VO${nanoid(4)}`,
    name: `View Only ${options.operatingMode} Alliance`,
  });
  const email = `viewer-${nanoid(6)}@e2e.test`;
  const { token } = await createHqInviteRow(sql, {
    allianceId: alliance.allianceId,
    email,
    roleName: options.roleName ?? "member",
    invitedByHqUserId: maintainer.hqUserId,
  });

  const accepted = await acceptInviteViaApi(sql, baseURL, token, email);

  return {
    sessionId: accepted.sessionId,
    hqUserId: accepted.hqUserId,
    email,
    nextAuthToken: accepted.nextAuthToken,
    allianceId: alliance.allianceId,
    tag: alliance.tag,
  };
}
