import { Lexer, type Token, type Tokens } from "marked";
import { z } from "zod";
import { redactIntakeText } from "./intake.shared";

export const publicationPreviewSchema = z.object({ requestId: z.string().min(8).max(120), noteId: z.string().min(1).max(160), expectedVersion: z.number().int().positive(), title: z.string().trim().min(1).max(160), body: z.string().trim().min(1).max(100_000), locale: z.enum(["en-US", "pt-BR"]), days: z.union([z.literal(1), z.literal(7), z.literal(30)]) });
export const publicationCommandSchema = z.object({ requestId: z.string().min(8).max(120), expectedVersion: z.number().int().positive(), command: z.enum(["publish", "revoke", "rotate"]), reviewed: z.boolean().default(false) });
export type Publication = { id: string; noteId: string; state: "draft" | "published" | "revoked"; version: number; snapshotVersion: number; title: string; body: string; locale: string; expiresAt: string; link: string | null };
export { sensitiveNotesPath } from "./privacy.shared";
function publicTokens(tokens: Token[]): string {
  return tokens.map((token) => {
    const content = "tokens" in token && Array.isArray(token.tokens) ? publicTokens(token.tokens) : "text" in token ? String(token.text) : "";
    switch (token.type) {
      case "image": case "html": case "def": return "";
      case "link": return (token as Tokens.Link).href === content ? "" : content;
      case "heading": return `${"#".repeat(Math.min(6, (token as Tokens.Heading).depth))} ${content}\n\n`;
      case "paragraph": return `${content}\n\n`;
      case "strong": return `**${content}**`;
      case "em": return `*${content}*`;
      case "del": return `~~${content}~~`;
      case "list": return (token as Tokens.List).items.map((item) => `- ${publicTokens(item.tokens)}`).join("\n") + "\n";
      case "table": { const table = token as Tokens.Table; return [table.header, ...table.rows].map((row) => row.map((cell) => publicTokens(cell.tokens)).join(" | ")).join("\n") + "\n"; }
      case "blockquote": return `${content}\n\n`;
      case "code": return `\n\`\`\`\n${content}\n\`\`\`\n`;
      case "codespan": return `\`${content}\``;
      case "br": case "space": case "hr": return "\n";
      default: return content;
    }
  }).join("");
}
export function publicSnapshotText(value: string): string {
  return redactIntakeText(publicTokens(Lexer.lex(value, { gfm: true })))
    .replace(/(?:https?:\/\/|\/(?:api|notes|officer-intel|shared)\/)[^\s<>]+/gi, "")
    .replace(/\b(?:note|meeting|task|source|draft|board):[A-Za-z0-9:_-]+/g, "")
    .replace(/\[\d+\]/g, "").trim();
}
