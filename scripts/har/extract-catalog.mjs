#!/usr/bin/env node
/**
 * Extract a sanitized Ashed/Base44 API catalog from local HAR files.
 * Reads har/*.har (gitignored — may contain JWTs). Writes docs/ashed-api-catalog.json.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const HAR_DIR = path.join(ROOT, "har");
const OUT_PATH = path.join(ROOT, "docs/ashed-api-catalog.json");

const APP_ID = "692b7e16a524fdd9dff3332d";

/** Ashed SPA paths: HQ kebab-case with hyphens removed. */
function trainwreckCase(hqRoute) {
  if (!hqRoute) return null;
  return `/${hqRoute.replace(/^\//, "").replace(/-/g, "")}`;
}

function enrichNavGroups(groups) {
  return groups.map((group) => ({
    ...group,
    pages: group.pages.map((page) => ({
      ...page,
      ashedRoute: trainwreckCase(page.hqRoute),
    })),
  }));
}

/** @type {Record<string, string>} */
const HAR_FILE_TO_NAV_GROUP = {
  "ashed.online-alliance_management.har": "alliance-management",
  "ashed.online-performance_and_reporting.har": "performance-reporting",
  "ashed.online-events_and_operations.har": "events-operations",
  "ashed.online-admin_and_settings.har": "admin-settings",
  "ashed.online-profile.har": "profile",
};

/** Nav mirror: Alliance HQ sidebar groups and pages (from ashed.online screenshot + HAR app-logs). */
const NAV_GROUPS = [
  {
    id: "alliance-management",
    label: "Alliance Management",
    pages: [
      {
        id: "dashboard",
        label: "Dashboard",
        hqRoute: "/dashboard",
        ashedPageLog: "Dashboard",
        entities: ["Member", "Alliance"],
        functions: [],
        integrations: [],
      },
      {
        id: "alliances",
        label: "Alliances",
        hqRoute: "/alliances",
        ashedPageLog: "Alliances",
        entities: ["Alliance", "Partner"],
        functions: ["recordPartnerEngagement"],
        integrations: [],
      },
      {
        id: "members",
        label: "Members",
        hqRoute: "/members",
        ashedPageLog: "Members",
        entities: ["Member", "Commendation", "Violation", "ExcusedRecord"],
        functions: ["setJoinedDate"],
        integrations: [],
      },
      {
        id: "waiting-list",
        label: "Waiting List",
        hqRoute: "/waiting-list",
        ashedPageLog: "WaitingList",
        entities: ["WaitingListMember"],
        functions: [],
        integrations: [],
      },
      {
        id: "alliance-tasks",
        label: "Alliance Tasks",
        hqRoute: "/alliance-tasks",
        ashedPageLog: "AllianceTasks",
        entities: ["AllianceTask"],
        functions: [],
        integrations: [],
      },
      {
        id: "merge-manager",
        label: "Merge Manager",
        hqRoute: "/merge-manager",
        ashedPageLog: null,
        ashedPageLogNote: "TBD — MergeSession entity seen in HAR; no log-user-in-app hit",
        entities: ["MergeSession"],
        functions: [],
        integrations: [],
      },
    ],
  },
  {
    id: "performance-reporting",
    label: "Performance & Reporting",
    pages: [
      {
        id: "vs-performance",
        label: "VS Performance",
        hqRoute: "/vs-performance",
        ashedPageLog: "VSPerformance",
        entities: ["VSScore", "VSCompetitionMeta"],
        functions: ["getAvailableVSWeeks"],
        integrations: [],
      },
      {
        id: "donations",
        label: "Donations",
        hqRoute: "/donations",
        ashedPageLog: "Donations",
        entities: ["Donation"],
        functions: [],
        integrations: [],
      },
      {
        id: "alliance-exercise",
        label: "Alliance Exercise",
        hqRoute: "/alliance-exercise",
        ashedPageLog: "AllianceExercise",
        entities: ["AllianceExercise", "AllianceExerciseScore"],
        functions: [],
        integrations: [],
      },
      {
        id: "reports",
        label: "Reports",
        hqRoute: "/reports",
        ashedPageLog: "Reports",
        entities: ["WeeklyVSReport", "WeeklyAllianceReport"],
        functions: ["generateWeeklyAllianceReport"],
        integrations: [],
      },
    ],
  },
  {
    id: "events-operations",
    label: "Events & Operations",
    pages: [
      {
        id: "desert-storm",
        label: "Desert Storm",
        hqRoute: "/desert-storm",
        ashedPageLog: null,
        ashedPageLogNote: "No log-user-in-app hit in events HAR — ashedRoute via trainwreckcase",
        entities: [
          "DesertStormEvent",
          "DesertStormScore",
          "DesertStormRoster",
          "DesertStormMapAssignment",
        ],
        functions: [],
        integrations: [],
      },
      {
        id: "canyon-storm",
        label: "Canyon Storm",
        hqRoute: "/canyon-storm",
        ashedPageLog: null,
        ashedPageLogNote: "No log-user-in-app hit in events HAR — ashedRoute via trainwreckcase",
        entities: ["CanyonStormEvent", "CanyonStormScore", "CanyonStormRoster"],
        functions: [],
        integrations: [],
      },
      {
        id: "other-events",
        label: "Other Events",
        hqRoute: "/seasonal-events",
        ashedPageLog: null,
        ashedPageLogNote: "No log-user-in-app hit in events HAR — ashedRoute via trainwreckcase",
        entities: ["SeasonalEvent", "SeasonalScore", "EventSeries"],
        functions: ["getSeasonalEvents"],
        integrations: [],
      },
      {
        id: "zombie-siege",
        label: "Zombie Siege",
        hqRoute: "/zombie-siege",
        ashedPageLog: null,
        ashedPageLogNote: "No log-user-in-app hit in events HAR — ashedRoute via trainwreckcase",
        entities: ["ZombieSiegeEvent", "ZombieSiegeScore"],
        functions: ["extractZombieSiegeData"],
        integrations: [],
      },
    ],
  },
  {
    id: "admin-settings",
    label: "Admin & Settings",
    pages: [
      {
        id: "data-management",
        label: "Data Management",
        hqRoute: "/data-management",
        ashedPageLog: "DataManagement",
        entities: [
          "VSScore",
          "Donation",
          "KillScore",
          "AllianceExerciseScore",
          "DesertStormScore",
          "SeasonalScore",
          "ZombieSiegeScore",
          "SeasonReward",
        ],
        functions: ["bulkDeleteByDate", "bulkMoveByDate", "manageSquadPowerData"],
        integrations: [
          "Core/UploadFile",
          "Core/ExtractDataFromUploadedFile",
          "Core/InvokeLLM",
        ],
      },
      {
        id: "unmatched-names",
        label: "Unmatched Names",
        hqRoute: "/unmatched-names",
        ashedPageLog: "UnmatchedNames",
        entities: ["UnmatchedName"],
        functions: [],
        integrations: [],
      },
      {
        id: "historical-import",
        label: "Historical Import",
        hqRoute: null,
        ashedPageLog: "HistoricalImport",
        ashedPageLogNote: "Ashed modal — only one app-log hit in admin HAR",
        entities: [],
        functions: [],
        integrations: ["Core/UploadFile", "Core/ExtractDataFromUploadedFile"],
      },
    ],
  },
  {
    id: "hq-native",
    label: "Alliance HQ (native)",
    pages: [
      {
        id: "video-upload",
        label: "Upload from video",
        hqRoute: "/tools/video-upload",
        ashedPageLog: null,
        entities: [],
        functions: [],
        integrations: ["Core/UploadFile", "Core/ExtractDataFromUploadedFile"],
      },
      {
        id: "settings",
        label: "Settings",
        hqRoute: "/settings",
        ashedPageLog: null,
        entities: [],
        functions: [],
        integrations: [],
      },
    ],
  },
  {
    id: "profile",
    label: "Profile (Ashed header menu)",
    pages: [
      {
        id: "profile",
        label: "Profile",
        hqRoute: null,
        ashedPageLog: "Profile",
        entities: ["User", "UserProfile", "EntitlementSnapshot", "Referral"],
        functions: [],
        integrations: [],
      },
    ],
  },
];

/** @type {Record<string, string>} */
const ENTITY_PERMISSIONS = {
  Member: "members:read",
  Commendation: "members:write",
  Violation: "members:write",
  ExcusedRecord: "members:read",
  WaitingListMember: "members:read",
  AllianceTask: "tasks:read",
  MergeSession: "merge:read",
  Alliance: "alliance:read",
  Partner: "alliance:read",
  VSScore: "scores:read",
  VSCompetitionMeta: "scores:read",
  Donation: "scores:read",
  AllianceExercise: "scores:read",
  AllianceExerciseScore: "scores:read",
  WeeklyVSReport: "reports:read",
  WeeklyAllianceReport: "reports:read",
  DesertStormEvent: "events:read",
  DesertStormScore: "events:read",
  DesertStormRoster: "events:read",
  DesertStormMapAssignment: "events:read",
  CanyonStormEvent: "events:read",
  CanyonStormScore: "events:read",
  CanyonStormRoster: "events:read",
  SeasonalEvent: "events:read",
  SeasonalScore: "events:read",
  EventSeries: "events:read",
  ZombieSiegeEvent: "events:read",
  ZombieSiegeScore: "events:read",
  KillScore: "scores:read",
  SeasonReward: "scores:read",
  TrainRoster: "scores:read",
  UnmatchedName: "data:read",
  EntitlementSnapshot: "alliance:read",
  User: "auth:read",
  UserProfile: "auth:read",
  Referral: "auth:read",
};

/** @type {Record<string, { read: string, write?: string }>} */
const FUNCTION_PERMISSIONS = {
  bulkDeleteByDate: { read: "data:bulk_delete", write: "data:bulk_delete" },
  bulkMoveByDate: { read: "data:bulk_move", write: "data:bulk_move" },
  manageSquadPowerData: { read: "scores:read", write: "scores:write" },
  generateWeeklyAllianceReport: {
    read: "reports:generate",
    write: "reports:generate",
  },
  getAvailableVSWeeks: { read: "scores:read" },
  setJoinedDate: { read: "members:write", write: "members:write" },
  recordPartnerEngagement: { read: "alliance:read", write: "alliance:write" },
  getSeasonalEvents: { read: "events:read" },
  extractZombieSiegeData: { read: "events:read", write: "events:write" },
};

/** @type {Record<string, string>} */
const INTEGRATION_PERMISSIONS = {
  "Core/UploadFile": "upload:write",
  "Core/ExtractDataFromUploadedFile": "upload:write",
  "Core/InvokeLLM": "upload:write",
};

/** @type {Record<string, { read: string, write: string }>} */
const ENTITY_WRITE_PERMISSIONS = {
  Member: { read: "members:read", write: "members:write" },
  AllianceTask: { read: "tasks:read", write: "tasks:write" },
  Commendation: { read: "members:read", write: "members:write" },
  Violation: { read: "members:read", write: "members:write" },
  VSScore: { read: "scores:read", write: "scores:write" },
  VSCompetitionMeta: { read: "scores:read", write: "scores:write" },
  Donation: { read: "scores:read", write: "scores:write" },
  AllianceExercise: { read: "scores:read", write: "scores:write" },
  AllianceExerciseScore: { read: "scores:read", write: "scores:write" },
  UnmatchedName: { read: "data:read", write: "data:write" },
  SeasonalEvent: { read: "events:read", write: "events:write" },
  SeasonalScore: { read: "events:read", write: "events:write" },
  DesertStormEvent: { read: "events:read", write: "events:write" },
  DesertStormScore: { read: "events:read", write: "events:write" },
  CanyonStormEvent: { read: "events:read", write: "events:write" },
  CanyonStormScore: { read: "events:read", write: "events:write" },
  ZombieSiegeEvent: { read: "events:read", write: "events:write" },
  ZombieSiegeScore: { read: "events:read", write: "events:write" },
  KillScore: { read: "scores:read", write: "scores:write" },
};

function normalizePath(url) {
  try {
    const u = new URL(url);
    return u.pathname
      .replace(/\/api\/apps\/[a-f0-9]{24}/gi, "/api/apps/{appId}")
      .replace(/\/api\/app-logs\/[a-f0-9]{24}\//gi, "/api/app-logs/{appId}/")
      .replace(/\/entities\/[A-Za-z]+\/[a-f0-9]{24}/g, (m) => {
        const parts = m.split("/");
        return `/entities/${parts[2]}/{id}`;
      })
      .replace(/\/public-settings\/by-id\/[a-f0-9]{24}/, "/public-settings/by-id/{appId}");
  } catch {
    return url;
  }
}

function classifyEndpoint(method, pathname) {
  if (pathname.includes("/entities/")) {
    const entity = pathname.match(/\/entities\/([A-Za-z]+)/)?.[1];
    const hasId = pathname.includes("/{id}");
    return { kind: "entity", entity, hasId };
  }
  if (pathname.includes("/functions/")) {
    const name = pathname.match(/\/functions\/([A-Za-z]+)/)?.[1];
    return { kind: "function", name };
  }
  if (pathname.includes("/integration-endpoints/")) {
    const name = pathname.match(/\/integration-endpoints\/(.+)$/)?.[1];
    return { kind: "integration", name };
  }
  if (pathname.includes("/analytics/")) {
    return { kind: "analytics", name: pathname };
  }
  if (pathname.includes("/log-user-in-app/")) {
    const page = pathname.match(/log-user-in-app\/([A-Za-z]+)/)?.[1];
    return { kind: "app-log", page };
  }
  if (pathname.includes("/public-settings/")) {
    return { kind: "public", name: "public-settings" };
  }
  return { kind: "other", name: pathname };
}

function parseHarFile(filename) {
  const filePath = path.join(HAR_DIR, filename);
  const har = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const navGroup = HAR_FILE_TO_NAV_GROUP[filename] ?? "unknown";
  /** @type {Map<string, { method: string, path: string, count: number, classified: object }>} */
  const endpoints = new Map();
  /** @type {Set<string>} */
  const appLogPages = new Set();

  for (const entry of har.log?.entries ?? []) {
    const url = entry.request?.url ?? "";
    if (!url.includes("base44.app") && !url.includes("base44")) {
      continue;
    }

    const method = entry.request?.method ?? "GET";
    const pathname = normalizePath(url);
    const key = `${method} ${pathname}`;
    const classified = classifyEndpoint(method, pathname);

    if (classified.kind === "app-log" && classified.page) {
      appLogPages.add(classified.page);
    }

    const existing = endpoints.get(key);
    if (existing) {
      existing.count++;
    } else {
      endpoints.set(key, { method, path: pathname, count: 1, classified });
    }
  }

  return { filename, navGroup, endpoints, appLogPages };
}

function buildCatalog() {
  if (!fs.existsSync(HAR_DIR)) {
    console.error(`HAR directory not found: ${HAR_DIR}`);
    process.exit(1);
  }

  const harFiles = fs.readdirSync(HAR_DIR).filter((f) => f.endsWith(".har"));
  if (harFiles.length === 0) {
    console.error(`No .har files in ${HAR_DIR}`);
    process.exit(1);
  }

  /** @type {Map<string, { methods: Set<string>, harFiles: Set<string>, navGroups: Set<string>, hasId: boolean }>} */
  const entityMap = new Map();
  /** @type {Map<string, { harFiles: Set<string>, navGroups: Set<string>, count: number }>} */
  const functionMap = new Map();
  /** @type {Map<string, { harFiles: Set<string>, navGroups: Set<string>, count: number }>} */
  const integrationMap = new Map();
  /** @type {Map<string, { harFiles: Set<string>, count: number }>} */
  const analyticsMap = new Map();
  /** @type {Set<string>} */
  const allAppLogPages = new Set();

  for (const filename of harFiles) {
    const parsed = parseHarFile(filename);

    for (const [, ep] of parsed.endpoints) {
      const { classified, method } = ep;

      if (classified.kind === "entity" && classified.entity) {
        const name = classified.entity;
        if (!entityMap.has(name)) {
          entityMap.set(name, {
            methods: new Set(),
            harFiles: new Set(),
            navGroups: new Set(),
            hasId: false,
          });
        }
        const rec = entityMap.get(name);
        rec.methods.add(method);
        rec.harFiles.add(filename);
        rec.navGroups.add(parsed.navGroup);
        if (classified.hasId) rec.hasId = true;
      }

      if (classified.kind === "function" && classified.name) {
        if (!functionMap.has(classified.name)) {
          functionMap.set(classified.name, {
            harFiles: new Set(),
            navGroups: new Set(),
            count: 0,
          });
        }
        const rec = functionMap.get(classified.name);
        rec.harFiles.add(filename);
        rec.navGroups.add(parsed.navGroup);
        rec.count += ep.count;
      }

      if (classified.kind === "integration" && classified.name) {
        if (!integrationMap.has(classified.name)) {
          integrationMap.set(classified.name, {
            harFiles: new Set(),
            navGroups: new Set(),
            count: 0,
          });
        }
        const rec = integrationMap.get(classified.name);
        rec.harFiles.add(filename);
        rec.navGroups.add(parsed.navGroup);
        rec.count += ep.count;
      }

      if (classified.kind === "analytics") {
        const key = ep.path;
        if (!analyticsMap.has(key)) {
          analyticsMap.set(key, { harFiles: new Set(), count: 0 });
        }
        const rec = analyticsMap.get(key);
        rec.harFiles.add(filename);
        rec.count += ep.count;
      }

      if (classified.kind === "app-log" && classified.page) {
        allAppLogPages.add(classified.page);
      }
    }
  }

  const entities = [...entityMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, rec]) => ({
      name,
      methods: [...rec.methods].sort(),
      harFiles: [...rec.harFiles].sort(),
      navGroups: [...rec.navGroups].sort(),
      supportsById: rec.hasId,
      bffPath: `/api/bff/v1/entities/${name}`,
      permissions: ENTITY_WRITE_PERMISSIONS[name] ?? {
        read: ENTITY_PERMISSIONS[name] ?? "data:read",
        write: `${(ENTITY_PERMISSIONS[name] ?? "data:read").replace(":read", ":write")}`,
      },
    }));

  const functions = [...functionMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, rec]) => ({
      name,
      method: "POST",
      harFiles: [...rec.harFiles].sort(),
      navGroups: [...rec.navGroups].sort(),
      requestCount: rec.count,
      bffPath: `/api/bff/v1/functions/${name}`,
      permissions: FUNCTION_PERMISSIONS[name] ?? {
        read: "data:read",
        write: "data:write",
      },
      destructive: name === "bulkDeleteByDate" || name === "bulkMoveByDate",
    }));

  const integrations = [...integrationMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, rec]) => ({
      name,
      method: "POST",
      harFiles: [...rec.harFiles].sort(),
      navGroups: [...rec.navGroups].sort(),
      requestCount: rec.count,
      bffPath: `/api/bff/v1/integration/${name.replace(/\//g, "--")}`,
      permissions: {
        read: INTEGRATION_PERMISSIONS[name] ?? "upload:write",
        write: INTEGRATION_PERMISSIONS[name] ?? "upload:write",
      },
    }));

  const analytics = [...analyticsMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pathPattern, rec]) => ({
      pathPattern,
      harFiles: [...rec.harFiles].sort(),
      requestCount: rec.count,
      proxyPriority: "low",
      note: "Telemetry — optional to proxy; not required for alliance data features",
    }));

  const rbacPermissions = buildRbacMatrix(entities, functions, integrations);

  return {
    generatedAt: new Date().toISOString(),
    source: "har/*.har (local, gitignored)",
    appId: APP_ID,
    baseUrl: "https://base44.app",
    notes: [
      "Sanitized catalog — no auth headers, cookies, or request/response bodies.",
      "ashed.online is a SPA; page context from log-user-in-app/{PageName} in HAR.",
      "HAR gaps: MergeManager, some event pages — see navGroups pages with ashedPageLog null.",
      "Ashed iframe paths use trainwreckcase: remove hyphens from hqRoute (e.g. /desert-storm → /desertstorm).",
    ],
    harFiles: harFiles.sort(),
    appLogPages: [...allAppLogPages].sort(),
    navGroups: enrichNavGroups(NAV_GROUPS),
    entities,
    functions,
    integrations,
    analytics,
    publicEndpoints: [
      {
        method: "GET",
        path: "/api/apps/public/prod/public-settings/by-id/{appId}",
        permissions: { read: "public", write: "public" },
        note: "No auth — may proxy as-is for app bootstrap",
      },
    ],
    rbac: rbacPermissions,
  };
}

function buildRbacMatrix(entities, functions, integrations) {
  const permissionDefs = [
    {
      id: "members:read",
      description: "View members, waiting list, excused records",
    },
    {
      id: "members:write",
      description: "Update members, commendations, violations, joined dates",
    },
    { id: "tasks:read", description: "View alliance tasks" },
    { id: "tasks:write", description: "Create and update alliance tasks" },
    { id: "merge:read", description: "View merge sessions" },
    { id: "merge:write", description: "Manage merge sessions" },
    { id: "alliance:read", description: "View alliance and partner data" },
    { id: "alliance:write", description: "Update alliance/partner engagement" },
    { id: "scores:read", description: "View VS, donations, exercise, kill scores" },
    {
      id: "scores:write",
      description: "Create/update score entities and squad power data",
    },
    { id: "reports:read", description: "View generated reports" },
    {
      id: "reports:generate",
      description: "Trigger weekly alliance report generation",
    },
    { id: "events:read", description: "View event rosters and scores" },
    { id: "events:write", description: "Create/update event data and extractions" },
    { id: "data:read", description: "View unmatched names and data management lists" },
    { id: "data:write", description: "Bulk unmatched name updates" },
    {
      id: "data:bulk_delete",
      description: "bulkDeleteByDate — destructive, high privilege",
    },
    {
      id: "data:bulk_move",
      description: "bulkMoveByDate — destructive, high privilege",
    },
    { id: "upload:write", description: "File upload and OCR/LLM integration endpoints" },
    { id: "auth:read", description: "User/me and profile reads" },
    {
      id: "alliance:admin",
      description: "Connect/disconnect Ashed token, manage HQ roles",
    },
  ];

  const roleTemplates = {
    owner: {
      description: "Alliance owner — full HQ access including token and RBAC admin",
      permissions: permissionDefs.map((p) => p.id),
    },
    officer: {
      description: "Senior officer — all data except bulk delete and alliance admin",
      permissions: permissionDefs
        .map((p) => p.id)
        .filter(
          (id) =>
            !["data:bulk_delete", "data:bulk_move", "alliance:admin"].includes(id),
        ),
    },
    data_entry: {
      description: "Score upload and member updates — no destructive ops",
      permissions: [
        "members:read",
        "members:write",
        "scores:read",
        "scores:write",
        "events:read",
        "events:write",
        "upload:write",
        "data:read",
        "tasks:read",
        "reports:read",
      ],
    },
    viewer: {
      description: "Read-only across alliance data",
      permissions: [
        "members:read",
        "tasks:read",
        "merge:read",
        "alliance:read",
        "scores:read",
        "reports:read",
        "events:read",
        "data:read",
        "auth:read",
      ],
    },
  };

  const operationMap = [
    ...entities.flatMap((e) =>
      e.methods.map((method) => ({
        type: "entity",
        name: e.name,
        method,
        permission:
          method === "GET"
            ? e.permissions.read
            : e.permissions.write ?? e.permissions.read,
      })),
    ),
    ...functions.map((f) => ({
      type: "function",
      name: f.name,
      method: "POST",
      permission: f.permissions.write ?? f.permissions.read,
    })),
    ...integrations.map((i) => ({
      type: "integration",
      name: i.name,
      method: "POST",
      permission: i.permissions.write,
    })),
  ].sort((a, b) =>
    `${a.type}:${a.name}:${a.method}`.localeCompare(`${b.type}:${b.name}:${b.method}`),
  );

  return {
    permissions: permissionDefs,
    roleTemplates,
    operationMap,
    denyByDefault: true,
    note: "BFF must check permission before forwarding any catalogued operation to Base44",
  };
}

function main() {
  const catalog = buildCatalog();
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  console.log(`Wrote ${OUT_PATH}`);
  console.log(
    `  ${catalog.entities.length} entities, ${catalog.functions.length} functions, ${catalog.integrations.length} integrations`,
  );
  console.log(`  ${catalog.navGroups.length} nav groups, ${catalog.harFiles.length} HAR files`);
}

main();
