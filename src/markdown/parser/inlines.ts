/**
 * Parses paragraph-like inline markdown into semantic inline nodes.
 */
import {
  createCode,
  createImage,
  createLineBreak,
  createLink,
  createMention,
  createRaw,
  createText,
  defragmentTextInlines,
} from "@/document";
import type { Inline, Mark } from "@/document";
import {
  inlineMarkSpecs,
  lineFeed,
  type InlineMarkDelimiter,
  type HtmlInlineMarkSpec,
} from "../shared";

// --- Single-character markers ---
// Each begins a construct without a paired closing delimiter: an escape applies
// to the next character; backticks build a variable-width inline-code fence; a
// colon starts a text directive; spaces are skipped inside link destinations.
const escapeMarker = "\\";
const inlineCodeMarker = "`";
const directiveMarker = ":";
const spaceCharacter = " ";

// --- Multi-character openings and closings ---
const imageOpening = "![";
const mentionOpening = "@[";
const linkOpening = "[";
const linkDestinationOpening = "(";
const linkDestinationClosing = ")";

// --- Regex matchers ---
const wordCharacter = /[\p{L}\p{N}]/u;
const textDirectiveNameStart = /[A-Za-z]/;
const textDirectiveNameCharacter = /[-A-Za-z0-9_]/;
// Sticky (`/y`) regex: `lastIndex` is set per call so the match is anchored
// at the current parse offset without slicing. Parsing is synchronous and
// single-threaded, so the shared `lastIndex` is safe — `readImageWidth`
// resets it at the top of every call.
const imageWidthAttribute = /\{width=([1-9]\d*)\}/y;
// The set of characters that survive a backslash escape in inline text.
// Both the post-flush unescape regex (`markdownTextEscape`) and the
// dispatcher-time existence check (`readGenericEscapeToken`) derive from
// this single class. `>` and `:` are present so the serializer can escape
// block-start prefixes (`> `, `:::name`) at paragraph line start without
// those backslashes surviving as literal text on the next round trip.
const escapableCharacterClass = "\\\\`*_[\\]{}()#+\\-.!~|@>:";
const markdownTextEscape = new RegExp(`\\\\([${escapableCharacterClass}])`, "g");
const escapableCharacter = new RegExp(`[${escapableCharacterClass}]`);
const markdownDestinationEscape = /\\(.)/g;

// --- Inline mark delimiters ---
// Flattened from `inlineMarkSpecs` in `../shared` so the dialect has a
// single source of truth for the parser ↔ serializer mark vocabulary. The
// sort is stable (ES2019+) and length-desc, so longer delimiters precede
// their shorter prefixes — `**` matches before `*` — and equal-length
// delimiters keep their source order (`*` before `_`).
type ParsedInlineMarkDelimiter = InlineMarkDelimiter & { mark: Mark };

const inlineMarkDelimiters: ReadonlyArray<ParsedInlineMarkDelimiter> = inlineMarkSpecs
  .filter((spec) => spec.kind === "delimiter")
  .flatMap((spec) =>
    spec.delimiters.map<ParsedInlineMarkDelimiter>((d) => ({
      mark: spec.mark,
      delimiter: d.delimiter,
      requireWordBoundary: d.requireWordBoundary,
    })),
  )
  .sort((left, right) => right.delimiter.length - left.delimiter.length);

const htmlInlineMarkSpecs: ReadonlyArray<HtmlInlineMarkSpec> = inlineMarkSpecs.filter(
  (spec) => spec.kind === "html",
);

export function parseInlines(source: string): Inline[] {
  return parseInlineRange(source, 0, source.length, []);
}

function parseInlineRange(source: string, start: number, end: number, marks: Mark[]): Inline[] {
  const nodes: Inline[] = [];
  let index = start;
  let textStart = start;

  while (index < end) {
    index = findNextInlineTokenStart(source, index, end);

    if (index < 0) {
      break;
    }

    const token = readInlineToken(source, index, end, marks);

    if (token) {
      // `trimLeading` lets a token (the hard-break readers) reach back into
      // the buffered text and strip the trailing characters that signaled
      // it (the two-or-more spaces, or the unescaped backslash).
      const flushEnd = Math.max(textStart, index - (token.trimLeading ?? 0));
      flushText(nodes, source.slice(textStart, flushEnd), marks);
      nodes.push(...token.nodes);
      index = token.end;
      textStart = index;
      continue;
    }

    index += 1;
  }

  flushText(nodes, source.slice(textStart, end), marks);
  return defragmentTextInlines(nodes);
}

// Token shape returned by every reader. `trimLeading` lets a reader pull
// characters back out of the buffered text just before it (the trailing
// spaces or backslash that signaled a hard break) — see the dispatcher
// loop in `parseInlineRange`.
type InlineToken = {
  end: number;
  nodes: Inline[];
  trimLeading?: number;
};

type InlineTokenReader = (
  source: string,
  index: number,
  end: number,
  marks: Mark[],
) => InlineToken | null;

// Order matters within a given lead character: the more specific reader
// runs first (for `<`, hard-break then semantic HTML marks, then catchall
// raw HTML; for `\`, the line-break shape before the generic escape).
const inlineTokenReaders: ReadonlyArray<{
  leadChars: ReadonlyArray<string>;
  read: InlineTokenReader;
}> = [
  { leadChars: [directiveMarker], read: readInlineDirectiveToken },
  { leadChars: ["<"], read: readLineBreakHtmlToken },
  { leadChars: ["<"], read: readHtmlMarkToken },
  { leadChars: ["<"], read: readRawHtmlToken },
  { leadChars: [escapeMarker], read: readBackslashLineBreakToken },
  { leadChars: [escapeMarker], read: readGenericEscapeToken },
  { leadChars: [lineFeed], read: readTrailingSpaceLineBreakToken },
  { leadChars: [inlineCodeMarker], read: readInlineCodeToken },
  { leadChars: ["!"], read: readImageToken },
  { leadChars: ["@"], read: readMentionToken },
  { leadChars: [linkOpening], read: readLinkToken },
  {
    leadChars: inlineMarkDelimiters.map((spec) => spec.delimiter[0]),
    read: readDelimitedMarkToken,
  },
];

const inlineReadersByLeadChar = buildInlineLeadCharIndex();
// Derived from the reader registry so plain prose can skip directly to the
// next character that could start a token without duplicating dialect policy.
const inlineTokenStartPattern = buildInlineTokenStartPattern();

function buildInlineLeadCharIndex(): Map<string, InlineTokenReader[]> {
  const index = new Map<string, InlineTokenReader[]>();
  for (const { leadChars, read } of inlineTokenReaders) {
    for (const char of leadChars) {
      const list = index.get(char);
      if (list) {
        list.push(read);
      } else {
        index.set(char, [read]);
      }
    }
  }
  return index;
}

function buildInlineTokenStartPattern() {
  const characterClass = [...inlineReadersByLeadChar.keys()]
    .map(escapeInlineTokenStartForCharacterClass)
    .join("");
  return new RegExp(`[${characterClass}]`, "g");
}

function escapeInlineTokenStartForCharacterClass(character: string) {
  return character === lineFeed ? "\\n" : character.replace(/[\\\]\[\^-]/g, "\\$&");
}

function readInlineToken(
  source: string,
  index: number,
  end: number,
  marks: Mark[],
): InlineToken | null {
  const readers = inlineReadersByLeadChar.get(source[index] ?? "");
  if (!readers) {
    return null;
  }

  for (const read of readers) {
    const token = read(source, index, end, marks);
    if (token) {
      return token;
    }
  }

  return null;
}

function findNextInlineTokenStart(source: string, start: number, end: number) {
  inlineTokenStartPattern.lastIndex = start;
  const match = inlineTokenStartPattern.exec(source);

  return match && match.index < end ? match.index : -1;
}

// --- Token readers, in dispatcher order ---
// Each returns `{ end, nodes }` on a successful match or `null` when no token
// of its kind starts at `index`. A null return tells the dispatcher to either
// try a fallback reader (see the `<` case above) or advance one character and
// keep scanning for the next token.

function readInlineDirectiveToken(source: string, index: number, end: number) {
  if (source[index] !== directiveMarker || !textDirectiveNameStart.test(source[index + 1] ?? "")) {
    return null;
  }

  let cursor = index + 2;

  while (cursor < end && textDirectiveNameCharacter.test(source[cursor] ?? "")) {
    cursor += 1;
  }

  const label = readBracketedSegment(source, cursor, end, "[", "]");
  const attributes = readBracketedSegment(source, label?.end ?? cursor, end, "{", "}");
  const rawEnd = attributes?.end ?? label?.end ?? cursor;

  return {
    end: rawEnd,
    nodes: [createRawInline("textDirective", source.slice(index, rawEnd))],
  };
}

function readHtmlMarkToken(source: string, index: number, end: number, marks: Mark[]) {
  for (const spec of htmlInlineMarkSpecs) {
    if (!source.startsWith(spec.openTag, index)) {
      continue;
    }

    const closeIndex = source.indexOf(spec.closeTag, index + spec.openTag.length);

    if (closeIndex < 0 || closeIndex >= end) {
      continue;
    }

    return {
      end: closeIndex + spec.closeTag.length,
      nodes: parseInlineRange(source, index + spec.openTag.length, closeIndex, [
        ...marks,
        spec.mark,
      ]),
    };
  }

  return null;
}

function readRawHtmlToken(source: string, index: number, end: number) {
  if (source[index] !== "<") {
    return null;
  }

  const closeIndex = source.indexOf(">", index + 1);

  if (closeIndex < 0 || closeIndex >= end) {
    return null;
  }

  return {
    end: closeIndex + 1,
    nodes: [createRawInline("html", source.slice(index, closeIndex + 1))],
  };
}

// Hard line breaks. We accept all three CommonMark encodings: `<br>`,
// trailing-spaces-before-newline, and backslash-newline. Bare `\n` is a
// soft break and falls through to text-buffering on purpose.

const lineBreakHtmlTag = /^<br\s*\/?>/i;

function readLineBreakHtmlToken(source: string, index: number, end: number) {
  if (source[index] !== "<") {
    return null;
  }

  const match = lineBreakHtmlTag.exec(source.slice(index, end));

  if (!match) {
    return null;
  }

  // Consume an immediately-following `\n` so authored `<br>\n` (a common
  // formatting choice — keeps source lines short) doesn't leave a soft
  // break in the text after the hard break. The serializer emits bare
  // `<br>`, so canonical output stays free of the trailing newline.
  const tagEnd = index + match[0].length;
  const consumedEnd = source[tagEnd] === lineFeed ? tagEnd + 1 : tagEnd;

  return {
    end: consumedEnd,
    nodes: [createLineBreak()],
  };
}

function readBackslashLineBreakToken(source: string, index: number, end: number) {
  if (source[index] !== escapeMarker || source[index + 1] !== lineFeed || index + 1 >= end) {
    // Anything else falls through to `readGenericEscapeToken`, which knows
    // how to consume a generic backslash escape.
    return null;
  }

  return {
    end: index + 2,
    nodes: [createLineBreak()],
  };
}

// Emits the unescaped X for recognized escapes, the literal `\X` otherwise
// (so `\a` round-trips as `\a`). Trailing `\` at end of input returns null
// so the dispatcher's default one-char advance preserves it as literal text.
function readGenericEscapeToken(source: string, index: number, end: number, marks: Mark[]) {
  if (source[index] !== escapeMarker || index + 1 >= end) {
    return null;
  }

  const escaped = source[index + 1]!;
  const text = escapableCharacter.test(escaped) ? escaped : source.slice(index, index + 2);

  return {
    end: index + 2,
    nodes: [createText(text, marks)],
  };
}

// Unique among the token readers: this one peeks BEHIND `index` (at the two
// characters already in the text buffer) to decide whether the current `\n`
// closes a trailing-spaces hard break. The buffered spaces are then stripped
// retroactively via `trimLeading` on the returned token — see the dispatcher
// loop in `parseInlineRange`.
function readTrailingSpaceLineBreakToken(source: string, index: number) {
  if (
    source[index] !== lineFeed ||
    source[index - 1] !== spaceCharacter ||
    source[index - 2] !== spaceCharacter
  ) {
    return null;
  }

  let trimLeading = 0;

  while (source[index - 1 - trimLeading] === spaceCharacter) {
    trimLeading += 1;
  }

  return {
    end: index + 1,
    nodes: [createLineBreak()],
    trimLeading,
  };
}

function readInlineCodeToken(source: string, index: number, end: number) {
  if (source[index] !== inlineCodeMarker) {
    return null;
  }

  let fenceWidth = 1;

  while (index + fenceWidth < end && source[index + fenceWidth] === inlineCodeMarker) {
    fenceWidth += 1;
  }

  const fence = inlineCodeMarker.repeat(fenceWidth);
  const closeIndex = source.indexOf(fence, index + fenceWidth);

  if (closeIndex < 0 || closeIndex >= end) {
    return null;
  }

  return {
    end: closeIndex + fenceWidth,
    nodes: [createCode(source.slice(index + fenceWidth, closeIndex))],
  };
}

function readImageToken(source: string, index: number, end: number) {
  if (!source.startsWith(imageOpening, index)) {
    return null;
  }

  const labelEnd = findClosingBracket(source, index + 1, end);

  if (labelEnd < 0 || source[labelEnd + 1] !== linkDestinationOpening) {
    return null;
  }

  const destination = readLinkDestination(source, labelEnd + 1, end);

  if (!destination) {
    return null;
  }

  const width = readImageWidth(source, destination.end, end);

  return {
    end: width?.end ?? destination.end,
    nodes: [
      createImage({
        alt: unescapeMarkdownText(source.slice(index + imageOpening.length, labelEnd)),
        title: destination.title,
        url: destination.url,
        width: width?.width ?? null,
      }),
    ],
  };
}

function readMentionToken(source: string, index: number, end: number) {
  if (!source.startsWith(mentionOpening, index)) {
    return null;
  }

  const labelEnd = findClosingBracket(source, index + 1, end);

  if (labelEnd < 0 || source[labelEnd + 1] !== linkDestinationOpening) {
    return null;
  }

  const destination = readLinkDestination(source, labelEnd + 1, end);

  if (!destination || destination.title !== null) {
    return null;
  }

  return {
    end: destination.end,
    nodes: [
      createMention({
        name: unescapeMarkdownText(source.slice(index + mentionOpening.length, labelEnd)),
        userId: destination.url,
      }),
    ],
  };
}

function readLinkToken(source: string, index: number, end: number, marks: Mark[]) {
  // Reject `[` that's the second byte of a malformed `![...]` image. Without
  // this guard, a failed image parse would leak through here and the bracketed
  // segment would be silently promoted to a link.
  if (source[index] !== linkOpening || source.startsWith(imageOpening, index - 1)) {
    return null;
  }

  const labelEnd = findClosingBracket(source, index, end);

  if (labelEnd < 0 || source[labelEnd + 1] !== linkDestinationOpening) {
    return null;
  }

  const destination = readLinkDestination(source, labelEnd + 1, end);

  if (!destination) {
    return null;
  }

  return {
    end: destination.end,
    nodes: [
      createLink({
        children: parseInlineRange(source, index + linkOpening.length, labelEnd, marks),
        title: destination.title,
        url: destination.url,
      }),
    ],
  };
}

function readLinkDestination(source: string, openParenIndex: number, end: number) {
  let index = skipSpaces(source, openParenIndex + 1, end);

  let urlEnd = index;

  while (
    urlEnd < end &&
    source[urlEnd] !== linkDestinationClosing &&
    source[urlEnd] !== spaceCharacter
  ) {
    if (source[urlEnd] === escapeMarker) {
      urlEnd += 2;
      continue;
    }

    urlEnd += 1;
  }

  if (urlEnd === index) {
    return null;
  }

  const url = unescapeMarkdownDestination(source.slice(index, urlEnd));
  index = skipSpaces(source, urlEnd, end);
  let title: string | null = null;

  if (index < end && source[index] === '"') {
    const titleEnd = findUnescapedSequence(source, '"', index + 1, end);

    if (titleEnd < 0) {
      return null;
    }

    title = source.slice(index + 1, titleEnd).replace(markdownDestinationEscape, "$1");
    index = skipSpaces(source, titleEnd + 1, end);
  }

  if (source[index] !== linkDestinationClosing) {
    return null;
  }

  return {
    end: index + 1,
    title,
    url,
  };
}

function readImageWidth(source: string, index: number, end: number) {
  // Sticky regex anchors the match at `lastIndex`, so we can scan in place
  // without slicing the remaining source.
  imageWidthAttribute.lastIndex = index;
  const match = imageWidthAttribute.exec(source);

  if (!match || imageWidthAttribute.lastIndex > end) {
    return null;
  }

  return {
    end: imageWidthAttribute.lastIndex,
    width: Number(match[1]),
  };
}

function readDelimitedMarkToken(source: string, index: number, end: number, marks: Mark[]) {
  for (const spec of inlineMarkDelimiters) {
    if (!source.startsWith(spec.delimiter, index)) {
      continue;
    }

    // Use the escape-aware sequence scan so `**foo \** bar**` doesn't close
    // prematurely on the escaped delimiter.
    const closeIndex = findUnescapedSequence(
      source,
      spec.delimiter,
      index + spec.delimiter.length,
      end,
    );

    if (closeIndex < 0) {
      continue;
    }

    if (spec.requireWordBoundary) {
      const before = index > 0 ? source[index - 1] : "";
      const after = source[closeIndex + spec.delimiter.length] ?? "";

      if (wordCharacter.test(before) || wordCharacter.test(after)) {
        continue;
      }
    }

    const contentStart = index + spec.delimiter.length;

    return {
      end: closeIndex + spec.delimiter.length,
      nodes: parseInlineRange(source, contentStart, closeIndex, [...marks, spec.mark]),
    };
  }

  return null;
}

// --- Text helpers ---
// Buffer plain-text spans between tokens. Adjacent same-mark runs are
// collapsed by `defragmentTextInlines` from the document subsystem when the
// range finishes parsing, so a parsed paragraph contains the smallest set of
// inline nodes possible. No unescape pass here — backslash escapes are
// consumed inline by `readGenericEscapeToken` before they can reach the
// buffer. `unescapeMarkdownText` is still used directly by the image alt
// and mention name readers, which consume their bracketed payloads verbatim
// instead of routing through `parseInlineRange`.

function flushText(nodes: Inline[], value: string, marks: Mark[]) {
  if (value.length === 0) {
    return;
  }

  nodes.push(createText(value, marks));
}

// --- Low-level utilities ---
// Generic scanning and escape helpers shared across token readers.

function readBracketedSegment(
  source: string,
  index: number,
  end: number,
  open: string,
  close: string,
) {
  if (source[index] !== open) {
    return null;
  }

  const closeIndex = findUnescapedSequence(source, close, index + 1, end);

  if (closeIndex < 0) {
    return null;
  }

  return {
    end: closeIndex + 1,
  };
}

function findClosingBracket(source: string, openBracketIndex: number, end: number) {
  return findUnescapedSequence(source, "]", openBracketIndex + 1, end);
}

// Returns the first occurrence of `sequence` (one or more characters) at or
// after `start` and before `end`, skipping any position whose preceding
// character is a backslash escape. Single-character call sites work without
// adaptation because `startsWith` of a one-char string is equivalent to a
// per-character comparison.
function findUnescapedSequence(source: string, sequence: string, start: number, end: number) {
  for (let index = start; index < end; index += 1) {
    if (source[index] === escapeMarker) {
      index += 1;
      continue;
    }

    if (source.startsWith(sequence, index)) {
      return index;
    }
  }

  return -1;
}

function skipSpaces(source: string, index: number, end: number) {
  while (index < end && source[index] === spaceCharacter) {
    index += 1;
  }

  return index;
}

function unescapeMarkdownText(value: string) {
  return value.replace(markdownTextEscape, "$1");
}

function unescapeMarkdownDestination(value: string) {
  return value.replace(markdownDestinationEscape, "$1");
}

function createRawInline(originalType: string, raw: string) {
  return createRaw({
    originalType,
    source: raw,
  });
}
