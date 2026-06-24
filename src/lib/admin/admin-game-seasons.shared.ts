import { z } from "zod";

export const patchGameSeasonCapsSchema = z
  .object({
    seasonId: z.string().trim().min(1),
    maxBaseVr: z.number().int().min(250).max(12750).optional(),
    maxProfessionLevel: z.number().int().min(1).nullable().optional(),
  })
  .refine(
    (body) =>
      body.maxBaseVr !== undefined || body.maxProfessionLevel !== undefined,
    {
      message: "At least one of maxBaseVr or maxProfessionLevel is required",
    },
  );

export type PatchGameSeasonCapsBody = z.infer<typeof patchGameSeasonCapsSchema>;

export function parsePatchGameSeasonCapsBody(
  input: unknown,
):
  | { ok: true; data: PatchGameSeasonCapsBody }
  | { ok: false; error: string } {
  const parsed = patchGameSeasonCapsSchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request body";
    return { ok: false, error: message };
  }
  return { ok: true, data: parsed.data };
}

export function gameSeasonCapsChanged(
  before: { maxBaseVr: number; maxProfessionLevel: number | null },
  after: { maxBaseVr: number; maxProfessionLevel: number | null },
): boolean {
  return (
    before.maxBaseVr !== after.maxBaseVr ||
    before.maxProfessionLevel !== after.maxProfessionLevel
  );
}
