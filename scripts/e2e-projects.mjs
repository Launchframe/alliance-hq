export const exclusiveE2eSpecs = [
  {
    name: "exclusive-frontline",
    file: "frontline-breakthrough.spec.ts",
    reason: "Installs a rollback constraint on the shared audit_log table.",
  },
  {
    name: "exclusive-team-invites",
    file: "team-invites.spec.ts",
    reason: "The no-server fixture alters the shared alliances table.",
  },
  {
    name: "exclusive-vs-weekly",
    file: "vs-performance-weekly.spec.ts",
    reason: "Installs a global train-paint failure trigger.",
  },
  {
    name: "exclusive-vs-ashed",
    file: "vs-performance-ashed.spec.ts",
    reason: "Controls the shared Ashed mock and adds capture rollback constraints.",
  },
];

export function createE2eProjects() {
  return [
    {
      name: "parallel",
      testIgnore: exclusiveE2eSpecs.map(({ file }) => `**/${file}`),
    },
    ...exclusiveE2eSpecs.map(({ name, file }, index) => ({
      name,
      testMatch: `**/${file}`,
      dependencies: [index === 0 ? "parallel" : exclusiveE2eSpecs[index - 1].name],
      fullyParallel: false,
    })),
  ];
}
