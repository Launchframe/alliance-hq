/**
 * Shared outputFileTracing config for video OCR serverless routes.
 * Imported by next.config.ts and scripts/vercel/analyze-function-trace.mjs — keep in sync.
 */

/** App-root sharp + libvips (linux-x64). Used globally because Turbopack externalizes sharp app-wide. */
export const sharpNativeFileTracing = [
  "./node_modules/sharp/**/*",
  "./node_modules/@img/sharp-linux-x64/**/*",
  "./node_modules/@img/sharp-libvips-linux-x64/**/*",
  "./node_modules/@img/sharp-libvips-linux-x64/lib/libvips-cpp.so*",
  "./node_modules/@img/colour/**/*",
  // Next.js ships its own sharp for image optimization; trace both layouts.
  "./node_modules/next/node_modules/sharp/**/*",
  "./node_modules/next/node_modules/@img/sharp-linux-x64/**/*",
  "./node_modules/next/node_modules/@img/sharp-libvips-linux-x64/**/*",
  "./node_modules/next/node_modules/@img/sharp-libvips-linux-x64/lib/libvips-cpp.so*",
  "./node_modules/next/node_modules/@img/colour/**/*",
];

/** @deprecated alias — prefer sharpNativeFileTracing */
export const sharpFileTracing = sharpNativeFileTracing;

/**
 * In-house roster OCR (tesseract.js v7). Spawns a Node worker thread that
 * loads WASM from tesseract.js-core at runtime. traineddata comes from jsDelivr
 * unless TESSERACT_LANG_PATH is set.
 */
export const tesseractFileTracing = [
  "./node_modules/tesseract.js/**/*",
  "./node_modules/tesseract.js-core/**/*",
  "./node_modules/wasm-feature-detect/**/*",
];

export const videoOcrFileTracing = [...sharpNativeFileTracing, ...tesseractFileTracing];

/** Non-LSTM cores are never selected for roster OCR (OEM.LSTM_ONLY). */
export const videoOcrFileTracingExcludes = [
  "./node_modules/tesseract.js-core/tesseract-core.js",
  "./node_modules/tesseract.js-core/tesseract-core.wasm",
  "./node_modules/tesseract.js-core/tesseract-core.wasm.js",
  "./node_modules/tesseract.js-core/tesseract-core-simd.js",
  "./node_modules/tesseract.js-core/tesseract-core-simd.wasm",
  "./node_modules/tesseract.js-core/tesseract-core-simd.wasm.js",
  "./node_modules/tesseract.js-core/tesseract-core-relaxedsimd.js",
  "./node_modules/tesseract.js-core/tesseract-core-relaxedsimd.wasm",
  "./node_modules/tesseract.js-core/tesseract-core-relaxedsimd.wasm.js",
];

/** Routes that bundle video OCR native deps — monitored in CI for Vercel 250 MB limit. */
export const videoOcrTracedRoutes = {
  "/api/internal/video-process/queue": videoOcrFileTracing,
  "/api/internal/video-process/[jobId]": videoOcrFileTracing,
  "/api/members/roster-import/parse": videoOcrFileTracing,
  "/api/tools/video-upload/[jobId]/reprocess": videoOcrFileTracing,
  "/api/admin/video-jobs/[jobId]/reprocess": videoOcrFileTracing,
};

/**
 * Uncompressed size budgets (bytes). CI runs on linux-x64 to approximate Vercel.
 * Primary gate: video-process queue cron worker (largest import graph).
 */
export const functionTraceBudgets = [
  {
    route: "/api/internal/video-process/queue",
    nftPath: ".next/server/app/api/internal/video-process/queue/route.js.nft.json",
    maxUncompressedBytes: 230 * 1024 * 1024,
  },
  {
    route: "/api/internal/video-process/[jobId]",
    nftPath:
      ".next/server/app/api/internal/video-process/[jobId]/route.js.nft.json",
    maxUncompressedBytes: 230 * 1024 * 1024,
  },
  {
    route: "/api/members/roster-import/parse",
    nftPath: ".next/server/app/api/members/roster-import/parse/route.js.nft.json",
    maxUncompressedBytes: 200 * 1024 * 1024,
  },
];
