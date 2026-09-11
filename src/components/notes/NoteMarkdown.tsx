import { Fragment, type ReactNode } from "react";
import { Lexer, type Token, type Tokens } from "marked";
import { safeNoteLink } from "@/lib/notes/markdown.shared";

function renderTokens(tokens: Token[]): ReactNode {
  return tokens.map((token, index) => {
    const content = "tokens" in token && Array.isArray(token.tokens) ? renderTokens(token.tokens) : "text" in token ? String(token.text) : token.raw;
    switch (token.type) {
      case "space": return null;
      case "heading": {
        const heading = token as Tokens.Heading;
        const Tag = (["h2", "h3", "h4", "h5", "h6"] as const)[Math.min(4, heading.depth - 1)];
        return <Tag key={index} className="mt-5 mb-2 font-semibold leading-snug text-hq-fg">{content}</Tag>;
      }
      case "paragraph": return <p key={index} className="my-3 leading-7">{content}</p>;
      case "strong": return <strong key={index}>{content}</strong>;
      case "em": return <em key={index}>{content}</em>;
      case "del": return <del key={index}>{content}</del>;
      case "codespan": return <code key={index} className="rounded bg-hq-surface-muted px-1 py-0.5 text-[0.9em]">{(token as Tokens.Codespan).text}</code>;
      case "code": return <pre key={index} className="my-3 overflow-x-auto rounded-xl border border-hq-border bg-hq-surface p-4 text-xs"><code>{(token as Tokens.Code).text}</code></pre>;
      case "blockquote": return <blockquote key={index} className="my-3 border-l-2 border-hq-accent pl-4 text-hq-fg-muted">{content}</blockquote>;
      case "br": return <br key={index} />;
      case "hr": return <hr key={index} className="my-5 border-hq-border" />;
      case "link": {
        const link = token as Tokens.Link;
        const href = safeNoteLink(link.href);
        return href ? <a key={index} href={href} rel="noopener noreferrer" target={href.startsWith("/") ? undefined : "_blank"} className="text-hq-accent underline underline-offset-2">{content}</a> : <Fragment key={index}>{content}</Fragment>;
      }
      case "list": {
        const list = token as Tokens.List;
        const Tag = list.ordered ? "ol" : "ul";
        return <Tag key={index} className={`my-3 space-y-1 pl-5 ${list.ordered ? "list-decimal" : "list-disc"}`}>{list.items.map((item, itemIndex) => <li key={itemIndex}>{item.task ? <input type="checkbox" checked={!!item.checked} readOnly tabIndex={-1} className="mr-2 align-middle accent-hq-accent" /> : null}{renderTokens(item.tokens)}</li>)}</Tag>;
      }
      case "table": {
        const table = token as Tokens.Table;
        return <div key={index} className="my-4 overflow-x-auto rounded-lg border border-hq-border"><table className="w-full border-collapse text-sm"><thead className="bg-hq-surface"><tr>{table.header.map((cell, column) => <th key={column} className="border-b border-hq-border px-3 py-2 text-left font-medium">{renderTokens(cell.tokens)}</th>)}</tr></thead><tbody>{table.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, column) => <td key={column} className="border-b border-hq-border px-3 py-2">{renderTokens(cell.tokens)}</td>)}</tr>)}</tbody></table></div>;
      }
      case "image": return <span key={index} className="text-hq-fg-muted">{(token as Tokens.Image).text}</span>;
      case "html": return <span key={index}>{token.raw}</span>;
      default: return <Fragment key={index}>{content}</Fragment>;
    }
  });
}

export function NoteMarkdown({ body }: { body: string }) {
  return <div className="break-words text-sm text-hq-fg [&_h2]:text-xl [&_h3]:text-lg">{renderTokens(Lexer.lex(body, { gfm: true, breaks: true }))}</div>;
}
