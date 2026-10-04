import { getObjectSize, getObjectStream } from "@/lib/storage";
import { parseBytesRangeHeader } from "@/lib/video/http-byte-range";
import { ocrScope, withOcrAdmin } from "@/lib/ocr/learning/api.server";
import { loadLearningAsset } from "@/lib/ocr/learning/corpus.server";
import { OcrLearningError, ocrHashSchema } from "@/lib/ocr/benchmark/types.shared";

export const runtime = "nodejs";
type Context = { params: Promise<{ caseId: string }> };

export async function GET(request: Request, context: Context) {
  return withOcrAdmin(async () => {
    const { caseId } = await context.params;
    const frame = new URL(request.url).searchParams.get("frame") ?? undefined;
    if (frame !== undefined && !ocrHashSchema.safeParse(frame).success) throw new OcrLearningError("invalid_frame");
    const asset = await loadLearningAsset(ocrScope(request), caseId, frame);
    const size = await getObjectSize(asset.storageKey);
    if (asset.expectedBytes != null && asset.expectedBytes !== size || frame && size > 20 * 1024 ** 2) throw new OcrLearningError("media_size_mismatch", 409);
    const range = parseBytesRangeHeader(request.headers.get("range"), size);
    if (range === "unsatisfiable" || range && (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end))) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const headers = new Headers({ "Content-Type": asset.contentType, "Accept-Ranges": "bytes", ETag: `"${asset.sha256}"`, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Content-Length": String(range ? range.end - range.start + 1 : size) });
    if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
    return new Response(await getObjectStream(asset.storageKey, range ?? undefined), { status: range ? 206 : 200, headers });
  });
}
