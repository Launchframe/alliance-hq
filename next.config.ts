import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

import packageJson from "./package.json" with { type: "json" };
import {
  videoOcrFileTracingExcludes,
  videoOcrTracedRoutes,
} from "./scripts/vercel/video-ocr-file-tracing.mjs";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** Vercel serverless runs linux-x64 — include sharp and libvips native binaries. */
const sharpFileTracing = [
  "./node_modules/sharp/**/*",
  "./node_modules/@img/sharp-linux-x64/**/*",
  "./node_modules/@img/sharp-libvips-linux-x64/**/*",
  "./node_modules/@img/sharp-libvips-linux-x64/lib/libvips-cpp.so*",
  "./node_modules/@img/colour/**/*",
];

/**
 * In-house roster OCR (tesseract.js v7). Spawns a Node worker thread that
 * loads WASM from tesseract.js-core at runtime. traineddata comes from jsDelivr
 * unless TESSERACT_LANG_PATH is set.
 */
const tesseractFileTracing = [
  "./node_modules/tesseract.js/**/*",
  "./node_modules/tesseract.js-core/**/*",
  "./node_modules/wasm-feature-detect/**/*",
];

const videoOcrFileTracing = [...sharpFileTracing, ...tesseractFileTracing];

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
