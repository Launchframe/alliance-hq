import { z } from "zod";

export const noteShareSchema = z.object({
  expectedVersion: z.number().int().positive(),
  grants: z.array(z.object({
    subjectKind: z.enum(["user", "officers"]),
    subjectId: z.string().min(1).max(120),
    role: z.enum(["read", "edit"]),
  })).max(100),
});

export type NoteShareInput = z.infer<typeof noteShareSchema>;
export type NoteShareState = {
  version: number;
  allianceId: string;
  recipients: Array<{ id: string; name: string | null; role: string }>;
  grants: NoteShareInput["grants"];
};
