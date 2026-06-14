import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.join(__dirname, "../..");
export const MESSAGES_DIR = path.join(ROOT, "messages");
export const LOCALES_CONFIG = JSON.parse(
  fs.readFileSync(path.join(__dirname, "locales.json"), "utf8"),
);
export const GLOSSARY = JSON.parse(
  fs.readFileSync(path.join(__dirname, "glossary.json"), "utf8"),
);

export function loadMessages(locale) {
  const filePath = path.join(MESSAGES_DIR, `${locale}.json`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function flattenMessages(obj, prefix = "") {
  const result = new Map();

  for (const [key, value] of Object.entries(obj)) {
    const messageKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      result.set(messageKey, value);
    } else if (value && typeof value === "object") {
      for (const [nestedKey, nestedValue] of flattenMessages(value, messageKey)) {
        result.set(nestedKey, nestedValue);
      }
    }
  }

  return result;
}

export function unflattenMessages(flatMap) {
  const root = {};

  for (const [messageKey, value] of flatMap) {
    const parts = messageKey.split(".");
    let node = root;

    for (let i = 0; i < parts.length - 1; i++) {
      node[parts[i]] ??= {};
      node = node[parts[i]];
    }

    node[parts.at(-1)] = value;
  }

  return root;
}

export function sortObjectKeys(obj) {
  if (typeof obj !== "object" || obj === null) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }

  return Object.fromEntries(
    Object.keys(obj)
      .sort()
      .map((key) => [key, sortObjectKeys(obj[key])]),
  );
}

function findBraceBlocks(str) {
  const blocks = [];

  for (let i = 0; i < str.length; i++) {
    if (str[i] !== "{") {
      continue;
    }

    let depth = 0;
    const start = i;

    for (; i < str.length; i++) {
      if (str[i] === "{") {
        depth++;
      } else if (str[i] === "}") {
        depth--;
        if (depth === 0) {
          blocks.push({
            start,
            end: i + 1,
            text: str.slice(start, i + 1),
          });
          break;
        }
      }
    }
  }

  return blocks;
}

function findRichTagBlocks(str) {
  const blocks = [];
  const tagPattern =
    /<([a-zA-Z][\w-]*)(?:\s[^>]*)?>([\s\S]*?)<\/\1>|<([a-zA-Z][\w-]*)(?:\s[^>]*)?\/>/g;

  for (const match of str.matchAll(tagPattern)) {
    blocks.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[0],
    });
  }

  return blocks.sort((a, b) => a.start - b.start);
}

function applyReplacements(str, blocks, prefix) {
  if (blocks.length === 0) {
    return { text: str, placeholders: new Map() };
  }

  const placeholders = new Map();
  let result = "";
  let cursor = 0;

  blocks.forEach((block, index) => {
    result += str.slice(cursor, block.start);
    const token = `__${prefix}_${index}__`;
    placeholders.set(token, block.text);
    result += token;
    cursor = block.end;
  });

  result += str.slice(cursor);
  return { text: result, placeholders };
}

export function protectString(str, glossaryTerms = GLOSSARY.doNotTranslate) {
  const placeholders = new Map();
  let text = str;
  let counter = 0;

  const sortedGlossary = [...glossaryTerms].sort((a, b) => b.length - a.length);
  for (const term of sortedGlossary) {
    if (!text.includes(term)) {
      continue;
    }

    const token = `__GLOSSARY_${counter}__`;
    placeholders.set(token, term);
    text = text.split(term).join(token);
    counter++;
  }

  const richBlocks = findRichTagBlocks(text);
  const richProtected = applyReplacements(text, richBlocks, "TAG");
  text = richProtected.text;
  for (const [token, value] of richProtected.placeholders) {
    placeholders.set(token, value);
  }

  const braceBlocks = findBraceBlocks(text);
  const braceProtected = applyReplacements(text, braceBlocks, "TOKEN");
  text = braceProtected.text;
  for (const [token, value] of braceProtected.placeholders) {
    placeholders.set(token, value);
  }

  return { text, placeholders };
}

export function restoreString(text, placeholders) {
  let restored = text;

  for (const [token, value] of placeholders) {
    restored = restored.split(token).join(value);
  }

  return restored;
}

export function normalizeIcuBlock(block) {
  const match = block.match(/^\{([a-zA-Z_][\w]*),\s*(plural|select)\b,(.*)\}$/s);
  if (!match) {
    return block;
  }

  const branches = [...match[3].matchAll(/\b(one|other|zero|few|many|two)\s*\{/g)]
    .map((entry) => entry[1])
    .sort();

  return `${match[1]}:${match[2]}:${branches.join(",")}`;
}

export function extractMessageTokens(str) {
  const vars = new Set();
  const icuBlocks = new Set();
  const richTags = new Set();

  for (const block of findBraceBlocks(str)) {
    if (/,\s*(plural|select)\b/.test(block.text)) {
      icuBlocks.add(normalizeIcuBlock(block.text));
    } else {
      const match = block.text.match(/^\{([a-zA-Z_][\w]*)\}$/);
      if (match) {
        vars.add(match[1]);
      }
    }
  }

  for (const match of str.matchAll(/<\/?([a-zA-Z][\w-]*)\b/g)) {
    richTags.add(match[1]);
  }

  return {
    vars: [...vars].sort(),
    icuBlocks: [...icuBlocks].sort(),
    richTags: [...richTags].sort(),
  };
}

export function setsEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((value, index) => value === b[index]);
}
