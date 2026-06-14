import { readFileSync } from "node:fs";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });
config({ path: ".env" });

const ROLE_IDS = {
  owner: "role-owner",
  maintainer: "role-maintainer",
  officer: "role-officer",
  data_entry: "role-data-entry",
  viewer: "role-viewer",
};

const HQ_PERMISSIONS = [
  { id: "hq:admin", description: "Platform maintainer — cross-alliance admin portal" },
  { id: "hq:audit:read", description: "Read alliance audit log" },
  { id: "hq:video:read", description: "List alliance video jobs" },
  { id: "hq:events:write", description: "Manage HQ native events" },
];

function getDatabaseUrl() {
  const isProduction = process.env.NODE_ENV === "production";
  const local = process.env.LOCAL_DATABASE_URL?.trim();
  let raw =
    !isProduction && local ? local : (process.env.DATABASE_URL?.trim() ?? local);
  if (!raw) throw new Error("DATABASE_URL / LOCAL_DATABASE_URL not set");
  try {
    const url = new URL(raw);
    url.searchParams.delete("schema");
    return url.toString();
  } catch {
    return raw;
  }
}

async function main() {
  const catalog = JSON.parse(
    readFileSync("docs/ashed-api-catalog.json", "utf8"),
  );
  const rbac = catalog.rbac;
  const permissions = [...rbac.permissions, ...HQ_PERMISSIONS];

  const roleTemplates = {
    ...rbac.roleTemplates,
    maintainer: {
      description:
        "Ashed collaborator — same HQ access as owner including alliance:admin",
      permissions: rbac.roleTemplates.owner.permissions,
    },
  };

  // Owner gets HQ event/audit/video read permissions
  roleTemplates.owner.permissions = [
    ...new Set([
      ...roleTemplates.owner.permissions,
      "hq:audit:read",
      "hq:video:read",
      "hq:events:write",
    ]),
  ];
  roleTemplates.maintainer.permissions = [...roleTemplates.owner.permissions];

  const url = getDatabaseUrl();
  const client = postgres(url, { max: 1, prepare: false });

  for (const perm of permissions) {
    await client`
      INSERT INTO permissions (id, description)
      VALUES (${perm.id}, ${perm.description ?? null})
      ON CONFLICT (id) DO UPDATE SET description = EXCLUDED.description
    `;
  }

  const systemRoles = [
    { id: ROLE_IDS.owner, name: "owner", description: roleTemplates.owner.description },
    {
      id: ROLE_IDS.maintainer,
      name: "maintainer",
      description: roleTemplates.maintainer.description,
    },
    {
      id: ROLE_IDS.officer,
      name: "officer",
      description: roleTemplates.officer.description,
    },
    {
      id: ROLE_IDS.data_entry,
      name: "data_entry",
      description: roleTemplates.data_entry.description,
    },
    {
      id: ROLE_IDS.viewer,
      name: "viewer",
      description: roleTemplates.viewer.description,
    },
  ];

  for (const role of systemRoles) {
    await client`
      INSERT INTO roles (id, alliance_id, name, description, is_system)
      VALUES (${role.id}, NULL, ${role.name}, ${role.description}, 1)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        is_system = EXCLUDED.is_system
    `;
  }

  for (const [roleKey, template] of Object.entries(roleTemplates)) {
    const roleId = ROLE_IDS[roleKey];
    if (!roleId) continue;

    await client`DELETE FROM role_permissions WHERE role_id = ${roleId}`;

    for (const permissionId of template.permissions) {
      await client`
        INSERT INTO role_permissions (role_id, permission_id)
        VALUES (${roleId}, ${permissionId})
        ON CONFLICT DO NOTHING
      `;
    }
  }

  console.log(
    `Seeded ${permissions.length} permissions and ${systemRoles.length} system roles.`,
  );
  console.log("");
  console.log("Platform maintainer bootstrap:");
  console.log(
    "  Set PLATFORM_BOOTSTRAP_EMAIL in env — first connect from that email when no maintainer exists.",
  );

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
