// Auto-mode presence generator for the playground. Picks a random readable
// snippet out of the current markdown content and turns it into a cursor
// anchor (prefix or suffix). Lives here — outside `useUsers.ts` — because the
// markdown scanning has nothing to do with the hook's React state.
import type { DocumentPresence } from "documint";

const minSnippetLength = 18;
const maxSnippetLength = 90;
const longLineThreshold = 42;
const autoPresenceColor = "#f97316";

export function createRandomAutoPresence(content: string, userId: string): DocumentPresence | null {
  const candidates = extractVisibleTextCandidates(content);

  if (candidates.length === 0) {
    return null;
  }

  const text = candidates[Math.floor(Math.random() * candidates.length)]!;

  return {
    color: autoPresenceColor,
    cursor: Math.random() > 0.5 ? { prefix: text } : { suffix: text },
    userId,
  };
}

function extractVisibleTextCandidates(content: string) {
  return stripCommentAppendix(content)
    .split("\n")
    .map((line) => sanitizeMarkdownLine(line))
    .filter((line) => line.length >= minSnippetLength)
    .flatMap((line) => collectCandidateSnippets(line));
}

function sanitizeMarkdownLine(line: string) {
  return line
    .replace(/^#{1,6}\s+/u, "")
    .replace(/^>\s?/u, "")
    .replace(/^[-*+]\s+(?:\[[ xX]\]\s+)?/u, "")
    .replace(/^\d+\.\s+/u, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .trim();
}

function stripCommentAppendix(content: string) {
  const appendixStart = content.indexOf("\n:::documint-comments");

  return appendixStart === -1 ? content : content.slice(0, appendixStart);
}

function collectCandidateSnippets(line: string) {
  if (line.length <= longLineThreshold) {
    return [line];
  }

  const snippets: string[] = [];
  const segments = line.split(/[.!?]/u).map((segment) => segment.trim());

  for (const segment of segments) {
    if (segment.length >= minSnippetLength && segment.length <= maxSnippetLength) {
      snippets.push(segment);
    }
  }

  return snippets.length > 0 ? snippets : [line.slice(0, maxSnippetLength).trim()];
}
