import { z } from "zod";
import { historyApi, historyJson } from "@/lib/notes/import-api.server";
import { commandHistoryImport, historyImportDetail, reviewHistoryMessages } from "@/lib/notes/imports.server";
import { historyReviewSchema } from "@/lib/notes/imports.shared";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }> };
const version = z.object({ requestId: z.string().min(8).max(120), expectedVersion: z.number().int().positive() });
const commandSchema = version.extend({ command: z.enum(["finalize", "commit", "cancel", "retry"]) });
const reviewSchema = version.extend({ edits: z.array(historyReviewSchema.omit({ expectedVersion: true }).extend({ id: z.string().min(1).max(120) })).min(1).max(50) });
export const GET = (request: Request, { params }: Props) => historyApi("notes:read", async (actor) => {
  const offset = z.coerce.number().int().min(0).max(5_000).parse(new URL(request.url).searchParams.get("offset") ?? 0);
  return { import: await historyImportDetail(actor, (await params).id, offset) };
});
export const POST = (request: Request, { params }: Props) => historyApi("notes:create", async (actor) => commandHistoryImport(actor, (await params).id, commandSchema.parse(await historyJson(request))));
export const PATCH = (request: Request, { params }: Props) => historyApi("notes:create", async (actor) => reviewHistoryMessages(actor, (await params).id, reviewSchema.parse(await historyJson(request))));
