import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

import packageJson from "./package.json" with { type: "json" };
import {
  globalOutputFileTracingIncludes,
  videoOcrFileTracingExcludes,
  videoOcrFileTracingIncludes,
} from "./scripts/vercel/video-ocr-file-tracing.mjs";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const isVideoWorkerStandalone = process.env.VIDEO_WORKER_STANDALONE === "1";
const isE2eIsolated = process.env.HQ_E2E_ISOLATED === "1";

if (isE2eIsolated && process.env.E2E_TEST !== "true") {
  throw new Error("HQ_E2E_ISOLATED requires E2E_TEST=true");
}

const nextConfig: NextConfig = {
  ...(isVideoWorkerStandalone ? { output: "standalone" as const } : {}),
  ...(isE2eIsolated
    ? {
        distDir: ".next-e2e",
        typescript: { tsconfigPath: "tsconfig.e2e-build.json" },
      }
    : {}),
  env: {
    NEXT_PUBLIC_APP_VERSION:
      process.env.NEXT_PUBLIC_APP_VERSION ?? packageJson.version,
  },
  experimental: {
    proxyClientMaxBodySize: "200mb",
  },
  outputFileTracingIncludes: {
    ...globalOutputFileTracingIncludes,
    "/guides/discord-train": ["./docs/guides/**/*"],
    "/admin/guides/video-pipeline": ["./docs/guides/**/*"],
    ...videoOcrFileTracingIncludes,
  },
  outputFileTracingExcludes: {
    "*": videoOcrFileTracingExcludes,
  },
  serverExternalPackages: [
    "ffmpeg-static",
    "tesseract.js",
    "tesseract.js-core",
    "wasm-feature-detect",
  ],
};

export default withNextIntl(nextConfig);
