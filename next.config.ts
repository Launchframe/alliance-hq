import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

import packageJson from "./package.json" with { type: "json" };
import {
  globalOutputFileTracingIncludes,
  videoOcrFileTracingExcludes,
  videoOcrTracedRoutes,
} from "./scripts/vercel/video-ocr-file-tracing.mjs";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const isVideoWorkerStandalone = process.env.VIDEO_WORKER_STANDALONE === "1";

const nextConfig: NextConfig = {
  ...(isVideoWorkerStandalone ? { output: "standalone" as const } : {}),
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
    ...videoOcrTracedRoutes,
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
