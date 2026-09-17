import { historyApi } from "@/lib/notes/import-api.server";
import { historyUploadTarget, putLocalHistoryAsset, sealHistoryAsset } from "@/lib/notes/imports.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
type Props = { params: Promise<{ id: string; assetId: string }> };
export const GET = (_request: Request, { params }: Props) => historyApi("notes:create", async (actor) => { const { id, assetId } = await params; return historyUploadTarget(actor, id, assetId); });
export const PUT = (request: Request, { params }: Props) => historyApi("notes:create", async (actor) => { const { id, assetId } = await params; await putLocalHistoryAsset(actor, id, assetId, request); return { ok: true }; });
export const POST = (_request: Request, { params }: Props) => historyApi("notes:create", async (actor) => { const { id, assetId } = await params; await sealHistoryAsset(actor, id, assetId); return { ok: true }; });
