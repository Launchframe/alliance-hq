import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createE2eProjects, exclusiveE2eSpecs } from "./e2e-projects.mjs";

const readSource = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

describe("E2E project scheduling", () => {
  it("enables two workers across files without intra-file parallelism", () => {
    const config = readSource("playwright.config.ts");
    expect(config).toMatch(/workers:\s*2\b/);
    expect(config).toContain("fullyParallel: false");
    expect(config).toContain("projects: createE2eProjects()");
  });

  it("assigns every existing spec exactly once and keeps exclusive files out of parallel", () => {
    const files = readdirSync(new URL("../e2e/", import.meta.url)).filter((file) => file.endsWith(".spec.ts"));
    const projects = createE2eProjects();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const glob = `**/${file}`;
      const owners = projects.filter((project) => project.testMatch ? project.testMatch === glob : !project.testIgnore.includes(glob));
      expect(owners, file).toHaveLength(1);
    }
    for (const { file, name, reason } of exclusiveE2eSpecs) {
      expect(files).toContain(file);
      expect(reason.length).toBeGreaterThan(0);
      expect(projects[0].testIgnore).toContain(`**/${file}`);
      expect(projects.find((project) => project.name === name).testMatch).toBe(`**/${file}`);
    }
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
