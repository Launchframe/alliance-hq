import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

import packageJson from "./package.json" with { type: "json" };

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** Native sharp + libvips must ship with serverless video/OCR routes on Vercel linux-x64. */
const sharpFileTracing = [
  "./node_modules/sharp/**/*",
  "./node_modules/@img/**/*",
];

/** Tesseract worker script + WASM core for in-house roster OCR on serverless. */
const tesseractFileTracing = [
  "./node_modules/tesseract.js/src/worker-script/**/*",
  "./node_modules/tesseract.js-core/**/*",
];

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
    "/api/internal/video-process/queue": [...sharpFileTracing, ...tesseractFileTracing],
    "/api/internal/video-process/[jobId]": [...sharpFileTracing, ...tesseractFileTracing],
    "/api/members/roster-import/parse": [...sharpFileTracing, ...tesseractFileTracing],
  },
  serverExternalPackages: ["ffmpeg-static", "sharp"],
};

export default withNextIntl(nextConfig);
