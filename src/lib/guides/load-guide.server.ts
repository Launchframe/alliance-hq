import { readFile } from "node:fs/promises";
import path from "node:path";

const GUIDES_DIR = "docs/guides";

export async function loadGuideMarkdown(slug: string): Promise<string> {
  const filePath = path.join(process.cwd(), GUIDES_DIR, `${slug}.md`);
  return readFile(filePath, "utf8");
}
