import path from "node:path";
import { defineConfig } from "vitest/config";

export const COVERED_LIB_FILES = [
  "src/lib/video/normalize-rows.ts",
  "src/lib/video/member-matcher.ts",
  "src/lib/video/review-validation.ts",
  "src/lib/video/score-targets.ts",
  "src/lib/video/submit-schemas.ts",
  "src/lib/video/pipeline-timer.ts",
  "src/lib/alliance/resolve.ts",
  "src/lib/events/video-jobs-types.ts",
  "src/lib/nav/routes.ts",
  "src/lib/storage/index.ts",
  "src/lib/storage/r2.ts",
] as const;

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: [...COVERED_LIB_FILES],
      thresholds: {
        lines: 99,
        functions: 97,
        branches: 87,
        statements: 98,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./src/test/server-only-stub.ts"),
    },
  },
});
