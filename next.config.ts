import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

import packageJson from "./package.json" with { type: "json" };
import {
  videoOcrFileTracingExcludes,
  videoOcrTracedRoutes,
} from "./scripts/vercel/video-ocr-file-tracing.mjs";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION:
      process.env.NEXT_PUBLIC_APP_VERSION ?? packageJson.version,
  },
  experimental: {
    proxyClientMaxBodySize: "200mb",
  },
  outputFileTracingIncludes: {
    "/guides/discord-train": ["./docs/guides/**/*"],
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
