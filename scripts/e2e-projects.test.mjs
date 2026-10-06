import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, matchesGlob, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createE2eProjects, exclusiveE2eSpecs } from "./e2e-projects.mjs";

const readSource = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

const defaultTestMatch = "**/*.@(spec|test).?(c|m)[jt]s?(x)";

function specFiles(root) {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .filter((file) => matchesGlob(file, defaultTestMatch));
}

function projectOwns(project, file) {
  return matchesGlob(file, project.testMatch ?? defaultTestMatch)
    && !(project.testIgnore ?? []).some((pattern) => matchesGlob(file, pattern));
}

function assertSpecOwnership(files) {
  const projects = createE2eProjects();
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    expect(projects.filter((project) => projectOwns(project, file)), file).toHaveLength(1);
  }
  for (const { file, name, reason } of exclusiveE2eSpecs) {
    const project = projects.find((candidate) => candidate.name === name);
    expect(reason.length).toBeGreaterThan(0);
    expect(files.filter((candidate) => projectOwns(project, candidate)), name).toEqual([file]);
    expect(projects[0].testIgnore).toContain(`**/${file}`);
    expect(project.testMatch).toBe(`**/${file}`);
  }
}

describe("E2E project scheduling", () => {
  it("enables two workers across files without intra-file parallelism", () => {
    const config = readSource("playwright.config.ts");
    expect(config).toMatch(/workers:\s*2\b/);
    expect(config).toContain("fullyParallel: false");
    expect(config).toContain("projects: createE2eProjects()");
  });

  it("assigns every existing spec exactly once and keeps exclusive files out of parallel", () => {
    assertSpecOwnership(specFiles(fileURLToPath(new URL("../e2e/", import.meta.url))));
  });

  it("inventories nested spec files and assigns them to the parallel project", () => {
    const root = mkdtempSync(join(tmpdir(), "e2e-projects-"));
    try {
      mkdirSync(join(root, "nested", "deep"), { recursive: true });
      writeFileSync(join(root, "top.spec.ts"), "");
      writeFileSync(join(root, "nested", "child.spec.ts"), "");
      writeFileSync(join(root, "nested", "deep", "child.test.tsx"), "");
      writeFileSync(join(root, "nested", "helper.ts"), "");
      expect(specFiles(root).sort()).toEqual([
        "nested/child.spec.ts",
        "nested/deep/child.test.tsx",
        "top.spec.ts",
      ]);
      const parallel = createE2eProjects()[0];
      for (const file of specFiles(root)) {
        expect(projectOwns(parallel, file), file).toBe(true);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an exclusive basename that would expand a single-file phase", () => {
    const files = [
      ...exclusiveE2eSpecs.map(({ file }) => file),
      "nested/parallel.spec.ts",
    ];
    assertSpecOwnership(files);
    expect(() => assertSpecOwnership([...files, `nested/${exclusiveE2eSpecs[0].file}`])).toThrow();
  });

  it("chains single-file exclusive phases after the parallel project without gaps", () => {
    const projects = createE2eProjects();
    expect(projects[0].name).toBe("parallel");
    expect(projects[0].dependencies).toBeUndefined();
    expect(new Set(projects.map((project) => project.name)).size).toBe(projects.length);
    expect(projects).toHaveLength(exclusiveE2eSpecs.length + 1);
    for (let index = 1; index < projects.length; index++) {
      expect(projects[index].dependencies).toEqual([projects[index - 1].name]);
      expect(projects[index].fullyParallel).toBe(false);
      expect(projects[index].testMatch).toBe(`**/${exclusiveE2eSpecs[index - 1].file}`);
    }
  });

  it("preserves caches in both server entry points", () => {
    for (const file of ["scripts/e2e-server.mjs", "scripts/e2e-server-isolated.mjs"]) {
      const source = readSource(file);
      expect(source).not.toMatch(/rm\s+-rf\s+\.next/);
      expect(source).not.toContain("rmSync");
      expect(source).not.toMatch(/npm\s+ci\b/);
    }
  });
});
