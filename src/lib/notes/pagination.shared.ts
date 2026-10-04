import { z } from "zod";

export const KNOWLEDGE_PAGE_SIZE = 50;
export const resourceCursorSchema = z.object({
  version: z.literal(1), scope: z.string().min(1).max(300), key: z.string().regex(/^[a-f0-9]{64}$/), id: z.string().min(1).max(160),
  position: z.union([z.iso.datetime({ precision: 6 }).refine((value) => !value.startsWith("0000-")), z.number().int().positive()]),
  direction: z.enum(["next", "previous"]),
}).strict();
export type ResourceCursor = z.infer<typeof resourceCursorSchema>;
export type ResourcePage<T> = { items: T[]; scope: string; nextCursor: string | null; previousCursor: string | null };
