import "dotenv/config";

import {
  closeMemberAllianceTenure,
  openMemberAllianceTenure,
} from "@/lib/members/member-tenure.server";
import { getDb, schema } from "@/lib/db";

async function main() {
  const db = getDb();
  const members = await db.select().from(schema.allianceMembers);

  for (const member of members) {
    if (member.status === "former") {
      await closeMemberAllianceTenure({
        allianceId: member.allianceId,
        ashedMemberId: member.ashedMemberId,
        leftAt: member.updatedAt ?? undefined,
      });
    } else {
      await openMemberAllianceTenure({
        allianceId: member.allianceId,
        ashedMemberId: member.ashedMemberId,
        gameUid: member.gameUid,
        joinedAt: member.createdAt,
      });
    }
  }

  console.log(`Backfill complete for ${members.length} alliance_members rows.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
