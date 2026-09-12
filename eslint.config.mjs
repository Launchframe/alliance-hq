import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "worktrees/**",
    ".worktrees/**",
    // GPLv3 lab tool (Frida / Python capture) — not part of the Next.js app
    "tools/lastwar-capture/**",
  ]),
]);

export default eslintConfig;
