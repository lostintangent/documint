/**
 * Parses paragraph-like inline markdown into semantic inline nodes.
 */
import {
  createImage,
  createLineBreak,
  createLink,
  createMention,
  createRaw,
  createResource,
  createText,
  defragmentTextInlines,
  extractPlainTextFromInlineNodes,
  resolveRegisteredResourceProtocol,
} from "@/document";
import type { Inline, Mark } from "@/document";
import {
  codePointAt,
  codePointBefore,
  inlineMarkSpecs,
  lineFeed,
  resolveEmphasisFlanking,
} from "../shared";
import type { MarkdownParseContext } from "./context";
import { readLinkDestinationText, readLinkReference } from "./references";

// --- Regex matchers ---
// A bare mention opens after whitespace and can't end inside a word.
const bareMentionOpener = /[\t\n ]/;
const bareMentionTerminator = /[\p{L}\p{N}_]/u;
// Sticky (`/y`) regexes match at `lastIndex`, which each reader sets first.
// A text directive's label and attributes skip escaped closing brackets.
const textDirective = /:[A-Za-z][-A-Za-z0-9_]*(\[(?:\\.|[^\\\]])*\])?(\{(?:\\.|[^\\}])*\})?/sy;
const imageWidthAttribute = /\{width=([1-9]\d*)\}/y;
const numericSpaceEntity = /^&#(?:x20|32);/i;
// The set of characters that survive a backslash escape in inline text, both
// in prose (`readEscapeToken`) and in image alts and mention names
// (`markdownTextEscape`). `<`, `>`, `:`, and `=` are present so the serializer
// can escape tag openings, block-start prefixes (`> `, `:::name`), and setext
// underlines without those backslashes surviving as literal text on the next
// round trip.
const escapableCharacterClass = "\\\\`*_[\\]{}()#+\\-.!~|@<>:=";
const markdownTextEscape = new RegExp(`\\\\([${escapableCharacterClass}])`, "g");
const escapableCharacter = new RegExp(`[${escapableCharacterClass}]`);
const markdownDestinationEscape = /\\(.)/g;

// --- Inline mark syntax ---
// Flattened from `inlineMarkSpecs` in `../shared` so the dialect has a
// single source of truth for the parser ↔ serializer mark vocabulary.
const delimitedMarkDelimiters = inlineMarkSpecs.flatMap((spec) =>
  spec.kind === "delimiter" ? [spec] : [],
);
const codeSpanDelimiter = delimitedMarkDelimiters.find((spec) => spec.mark === "code")!;
const htmlMarkTags = inlineMarkSpecs.flatMap((spec) =>
  spec.kind === "delimiter"
    ? []
    : spec.tags.map((tag) => ({ closeTag: `</${tag}>`, mark: spec.mark, openTag: `<${tag}>` })),
);

export function parseInlines(source: string, context: MarkdownParseContext): Inline[] {
  return parseInlineRange(source, 0, source.length, [], context);
}

function parseInlineRange(
  source: string,
  start: number,
  end: number,
  marks: Mark[],
  context: MarkdownParseContext,
): Inline[] {
  const nodes: Inline[] = [];
  const emphasisRuns: EmphasisRun[] = [];
  let index = start;
  let textStart = start;

  while (index < end) {
    index = findNextInlineTokenStart(source, index, end);

    if (index < 0) {
      break;
    }

    const token = readInlineToken(source, index, end, marks, context);

    if (token) {
      const flushEnd = Math.max(textStart, index - (token.trimLeading ?? 0));
      flushText(nodes, source.slice(textStart, flushEnd), marks);
      if (token.emphasisRun) {
        token.emphasisRun.node = nodes.length;
        emphasisRuns.push(token.emphasisRun);
      }
      nodes.push(...token.nodes);
      index = token.end;
      textStart = index;
      continue;
    }

    index += 1;
  }

  flushText(nodes, source.slice(textStart, end), marks);
  return defragmentTextInlines(
    emphasisRuns.length > 0 ? applyEmphasis(nodes, emphasisRuns, marks) : nodes,
  );
}

// Token shape returned by every reader. `trimLeading` strips characters from
// the text buffered just before the token, like the trailing spaces that
// signal a hard break. `emphasisRun` marks the token's single text node as a
// `*`/`_` run that `applyEmphasis` pairs once the range is read.
type InlineToken = {
  emphasisRun?: EmphasisRun;
  end: number;
  nodes: Inline[];
  trimLeading?: number;
};

type InlineTokenReader = (
  source: string,
  index: number,
  end: number,
  marks: Mark[],
  context: MarkdownParseContext,
) => InlineToken | null;

// Readers keyed by the character every token they read starts with, so a
// reader can assume `source[index]` is its lead character. Order matters
// within a key: the more specific reader runs first (for `<`, hard-break
// then semantic HTML marks, then catchall raw HTML; for `@`, bracketed before
// bare mentions).
// Mark delimiter lead chars must stay distinct from the literal keys, since a
// repeated key would replace the earlier readers.
const inlineReadersByLeadChar = new Map<string, ReadonlyArray<InlineTokenReader>>([
  [":", [readInlineDirectiveToken]],
  ["&", [readNumericSpaceEntityToken]],
  ["<", [readLineBreakHtmlToken, readHtmlMarkToken, readRawHtmlToken]],
  ["\\", [readEscapeToken]],
  [lineFeed, [readTrailingSpaceLineBreakToken]],
  ["!", [readImageToken]],
  ["@", [readBracketedMentionToken, readBareMentionToken]],
  ["[", [readLinkToken]],
  ["*", [readEmphasisRunToken]],
  ["_", [readEmphasisRunToken]],
  ...delimitedMarkDelimiters.map((spec) => [spec.delimiter[0]!, [readDelimitedMarkToken]] as const),
]);
// Derived from the reader table so plain prose can skip directly to the
// next character that could start a token without duplicating dialect policy.
// Characters that are special inside a character class are escaped.
const inlineTokenStartPattern = new RegExp(
  `[${[...inlineReadersByLeadChar.keys()].join("").replace(/[\\\]^-]/g, "\\$&")}]`,
  "g",
);

function readInlineToken(
  source: string,
  index: number,
  end: number,
  marks: Mark[],
  context: MarkdownParseContext,
): InlineToken | null {
  const readers = inlineReadersByLeadChar.get(source[index] ?? "");
  if (!readers) {
    return null;
  }

  for (const read of readers) {
    const token = read(source, index, end, marks, context);
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

// A text directive needs a label or attributes, so prose like `Note:Use`,
// `Napi::Object` and `:heart:` shortcodes stays text.
function readInlineDirectiveToken(source: string, index: number, end: number) {
  textDirective.lastIndex = index;
  const match = textDirective.exec(source.slice(0, end));

  if (!match?.[1] && !match?.[2]) {
    return null;
  }

  return {
    end: textDirective.lastIndex,
    nodes: [createRaw({ originalType: "textDirective", source: match[0] })],
  };
}

function readNumericSpaceEntityToken(source: string, index: number, end: number, marks: Mark[]) {
  const match = numericSpaceEntity.exec(source.slice(index, end));

  if (!match) {
    return null;
  }

  return {
    end: index + match[0].length,
    nodes: [createText(" ", marks)],
  };
}

function readHtmlMarkToken(
  source: string,
  index: number,
  end: number,
  marks: Mark[],
  context: MarkdownParseContext,
) {
  for (const tag of htmlMarkTags) {
    if (!source.startsWith(tag.openTag, index)) {
      continue;
    }

    const closeIndex = source.indexOf(tag.closeTag, index + tag.openTag.length);

    if (closeIndex < 0 || closeIndex >= end) {
      continue;
    }

    return {
      end: closeIndex + tag.closeTag.length,
      nodes: parseInlineRange(
        source,
        index + tag.openTag.length,
        closeIndex,
        [...marks, tag.mark],
        context,
      ),
    };
  }

  return null;
}

function readRawHtmlToken(source: string, index: number, end: number) {
  const closeIndex = source.indexOf(">", index + 1);

  if (closeIndex < 0 || closeIndex >= end) {
    return null;
  }

  return {
    end: closeIndex + 1,
    // A tag that wraps across lines drops each line's indentation, as GFM
    // strips it from every paragraph line.
    nodes: [
      createRaw({
        originalType: "html",
        source: source.slice(index, closeIndex + 1).replace(/\n[ \t]+/g, lineFeed),
      }),
    ],
  };
}

// Hard line breaks. We accept all three CommonMark encodings: `<br>`,
// trailing-spaces-before-newline, and backslash-newline. Bare `\n` is a
// soft break and falls through to text-buffering on purpose.

const lineBreakHtmlTag = /^<br\s*\/?>/i;

function readLineBreakHtmlToken(source: string, index: number, end: number) {
  const match = lineBreakHtmlTag.exec(source.slice(index, end));

  if (!match) {
    return null;
  }

  // Consume a following `\n` so authored `<br>\n` doesn't leave a soft break
  // after the hard break. The serializer writes a bare `<br>`.
  const tagEnd = index + match[0].length;
  const consumedEnd = source[tagEnd] === lineFeed ? tagEnd + 1 : tagEnd;

  return {
    end: consumedEnd,
    nodes: [createLineBreak()],
  };
}

// Emits the unescaped X for recognized escapes, the literal `\X` otherwise
// (so `\a` round-trips as `\a`), and a hard break for backslash-newline.
// Trailing `\` at end of input returns null so the dispatcher's default
// one-char advance preserves it as literal text.
function readEscapeToken(source: string, index: number, end: number, marks: Mark[]) {
  if (index + 1 >= end) {
    return null;
  }

  const escaped = source[index + 1]!;
  const text = escapableCharacter.test(escaped) ? escaped : source.slice(index, index + 2);

  return {
    end: index + 2,
    nodes: [escaped === lineFeed ? createLineBreak() : createText(text, marks)],
  };
}

// Peeks behind the `\n` at the spaces already buffered as text, which
// `trimLeading` then strips.
function readTrailingSpaceLineBreakToken(source: string, index: number) {
  let trimLeading = 0;

  while (source[index - 1 - trimLeading] === " ") {
    trimLeading += 1;
  }

  return trimLeading < 2 ? null : { end: index + 1, nodes: [createLineBreak()], trimLeading };
}

function readImageToken(
  source: string,
  index: number,
  end: number,
  _marks: Mark[],
  context: MarkdownParseContext,
) {
  if (!source.startsWith("![", index)) {
    return null;
  }

  const labelEnd = findClosingBracket(source, index + 1, end);
  const destination =
    labelEnd < 0
      ? null
      : (readLinkDestination(source, labelEnd + 1, end) ??
        readLinkReference(source, index + 2, labelEnd, end, context));

  if (!destination) {
    return null;
  }

  const width = readImageWidth(source, destination.end, end);

  return {
    end: width?.end ?? destination.end,
    nodes: [
      createImage({
        alt: unescapeMarkdownText(source.slice(index + 2, labelEnd)),
        title: destination.title,
        url: destination.url,
        width: width?.width ?? null,
      }),
    ],
  };
}

function readBracketedMentionToken(source: string, index: number, end: number) {
  if (!source.startsWith("@[", index)) {
    return null;
  }

  const labelEnd = findClosingBracket(source, index + 1, end);
  const destination = labelEnd < 0 ? null : readLinkDestination(source, labelEnd + 1, end);

  if (!destination || destination.title !== null) {
    return null;
  }

  return {
    end: destination.end,
    nodes: [
      createMention({
        name: unescapeMarkdownText(source.slice(index + 2, labelEnd)),
        userId: destination.url,
      }),
    ],
  };
}

function readBareMentionToken(
  source: string,
  index: number,
  end: number,
  _marks: Mark[],
  context: MarkdownParseContext,
) {
  if (
    context.mentionTargets === null ||
    (index > 0 && !bareMentionOpener.test(source[index - 1]!))
  ) {
    return null;
  }

  for (const target of context.mentionTargets) {
    const nameEnd = index + 1 + target.name.length;

    if (
      nameEnd <= end &&
      source.startsWith(target.name, index + 1) &&
      !bareMentionTerminator.test(source[nameEnd] ?? "")
    ) {
      return {
        end: nameEnd,
        nodes: [createMention(target)],
      };
    }
  }

  return null;
}

function readLinkToken(
  source: string,
  index: number,
  end: number,
  marks: Mark[],
  context: MarkdownParseContext,
) {
  const labelEnd = findClosingBracket(source, index, end);
  const destination =
    labelEnd < 0
      ? null
      : (readLinkDestination(source, labelEnd + 1, end) ??
        readLinkReference(source, index + 1, labelEnd, end, context));

  if (!destination) {
    return null;
  }

  const children = parseInlineRange(source, index + 1, labelEnd, marks, context);

  // Links can't nest, and CommonMark keeps the innermost one, so
  // `[a [b](u)](v)` leaves the outer brackets as text around the inner link.
  if (children.some((child) => child.type === "link" || child.type === "resource")) {
    return null;
  }

  const isResource =
    context.resourceProtocols !== null &&
    resolveRegisteredResourceProtocol(destination.url, context.resourceProtocols) !== null;

  return {
    end: destination.end,
    nodes: [
      isResource
        ? createResource({
            label: extractPlainTextFromInlineNodes(children),
            url: destination.url,
          })
        : createLink({
            children,
            title: destination.title,
            url: destination.url,
          }),
    ],
  };
}

function readLinkDestination(source: string, openParenIndex: number, end: number) {
  if (source[openParenIndex] !== "(") {
    return null;
  }

  let index = skipWhitespace(source, openParenIndex + 1, end);
  const destination = readLinkDestinationText(source, index, end);

  if (!destination) {
    return null;
  }

  const url = destination.text.replace(markdownDestinationEscape, "$1");
  index = skipWhitespace(source, destination.end, end);
  let title: string | null = null;

  if (index < end && source[index] === '"') {
    const titleEnd = findUnescapedSequence(source, '"', index + 1, end);

    if (titleEnd < 0) {
      return null;
    }

    title = source.slice(index + 1, titleEnd).replace(markdownDestinationEscape, "$1");
    index = skipWhitespace(source, titleEnd + 1, end);
  }

  if (source[index] !== ")") {
    return null;
  }

  return {
    end: index + 1,
    title,
    url,
  };
}

function readImageWidth(source: string, index: number, end: number) {
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

function readDelimitedMarkToken(
  source: string,
  index: number,
  end: number,
  marks: Mark[],
  context: MarkdownParseContext,
) {
  for (const spec of delimitedMarkDelimiters) {
    if (!source.startsWith(spec.delimiter, index)) {
      continue;
    }

    const delimiter = resolveOpeningDelimiter(source, index, spec);
    const contentStart = index + delimiter.length;
    const closeIndex =
      spec.content === "literal"
        ? source.indexOf(delimiter, contentStart)
        : findUnescapedSequence(source, delimiter, contentStart, end);

    if (closeIndex < 0 || closeIndex >= end) {
      continue;
    }

    const marked = [...marks, spec.mark];

    return {
      end: closeIndex + delimiter.length,
      nodes:
        spec.content === "literal"
          ? [createText(source.slice(contentStart, closeIndex), marked)]
          : parseInlineRange(source, contentStart, closeIndex, marked, context),
    };
  }

  return null;
}

function resolveOpeningDelimiter(source: string, index: number, spec: typeof codeSpanDelimiter) {
  if (spec.content !== "literal") {
    return spec.delimiter;
  }

  let width = 1;

  while (source.startsWith(spec.delimiter, index + width * spec.delimiter.length)) {
    width += 1;
  }

  return spec.delimiter.repeat(width);
}

// --- Emphasis ---
// `*` and `_` runs follow CommonMark's delimiter-run algorithm rather than a
// first-match reader, so nested and adjacent emphasis (`***a** b*`,
// `**a *b***`, `**_a_:** b`) pairs the way GitHub renders it. Each run is read
// as literal text with its flanking, and `applyEmphasis` pairs the runs of a
// whole inline range once it's read. Links, code and HTML marks are read as
// atomic tokens first, so emphasis never crosses their boundaries.

type EmphasisRun = {
  canClose: boolean;
  canOpen: boolean;
  character: string;
  // Original run length, which the rule of 3 reads.
  length: number;
  // Index of the run's text node in the range's node list.
  node: number;
  remaining: number;
};

function readEmphasisRunToken(source: string, index: number, end: number, marks: Mark[]) {
  const character = source[index]!;
  let runEnd = index + 1;

  while (runEnd < end && source[runEnd] === character) {
    runEnd += 1;
  }

  const length = runEnd - index;
  const flanking = resolveEmphasisFlanking(
    character,
    codePointBefore(source, index),
    codePointAt(source, runEnd),
  );

  return {
    emphasisRun: { ...flanking, character, length, node: -1, remaining: length },
    end: runEnd,
    nodes: [createText(source.slice(index, runEnd), marks)],
  };
}

// CommonMark's "process emphasis". Each closer pairs with the nearest
// compatible opener, two characters wide when both runs have two left, and the
// runs between a pair can't open anything later. A pair adds its mark to every
// node between the two runs, and unpaired characters stay literal text.
function applyEmphasis(nodes: Inline[], runs: EmphasisRun[], marks: Mark[]): Inline[] {
  const addedMarks: Mark[][] = [];
  // Lowest opener worth searching per closer kind, so unmatched closers
  // don't rescan the same runs.
  const openersBottom = new Map<string, number>();

  for (let closerIndex = 0; closerIndex < runs.length; closerIndex += 1) {
    const closer = runs[closerIndex]!;
    const bottomKey = `${closer.character}${closer.canOpen}${closer.length % 3}`;

    while (closer.canClose && closer.remaining > 0) {
      const openerIndex = findEmphasisOpener(runs, closerIndex, openersBottom.get(bottomKey) ?? -1);

      if (openerIndex < 0) {
        openersBottom.set(bottomKey, closerIndex - 1);
        break;
      }

      const opener = runs[openerIndex]!;
      const width = opener.remaining >= 2 && closer.remaining >= 2 ? 2 : 1;
      const mark = width === 2 ? "bold" : "italic";
      opener.remaining -= width;
      closer.remaining -= width;

      for (let index = openerIndex + 1; index < closerIndex; index += 1) {
        runs[index]!.canOpen = false;
      }

      for (let index = opener.node + 1; index < closer.node; index += 1) {
        (addedMarks[index] ??= []).push(mark);
      }
    }
  }

  if (addedMarks.length === 0) {
    return nodes;
  }

  for (const run of runs) {
    nodes[run.node] = createText(run.character.repeat(run.remaining), marks);
  }

  addedMarks.forEach((added, index) => {
    nodes[index] = addMarks(nodes[index]!, added);
  });

  return nodes.filter((node) => node.type !== "text" || node.text.length > 0);
}

function findEmphasisOpener(runs: EmphasisRun[], closerIndex: number, bottom: number) {
  const closer = runs[closerIndex]!;

  for (let index = closerIndex - 1; index > bottom; index -= 1) {
    const opener = runs[index]!;

    if (
      opener.canOpen &&
      opener.remaining > 0 &&
      opener.character === closer.character &&
      // A run that can both open and close only pairs when the two run lengths
      // don't sum to a multiple of 3, unless both are multiples of 3. This keeps
      // `*a**b*` as one emphasis around a literal `**`.
      !(
        (opener.canClose || closer.canOpen) &&
        (opener.length + closer.length) % 3 === 0 &&
        (opener.length % 3 !== 0 || closer.length % 3 !== 0)
      )
    ) {
      return index;
    }
  }

  return -1;
}

function addMarks(node: Inline, marks: Mark[]): Inline {
  switch (node.type) {
    case "text":
      return createText(node.text, [...node.marks, ...marks]);
    case "link":
      return { ...node, children: node.children.map((child) => addMarks(child, marks)) };
    default:
      return node;
  }
}

// --- Low-level utilities ---
// Generic scanning and escape helpers shared across token readers.

function flushText(nodes: Inline[], value: string, marks: Mark[]) {
  if (value.length > 0) {
    nodes.push(createText(value, marks));
  }
}

// Returns the `]` that closes the bracket at `openBracketIndex`, as CommonMark
// matches link text: nested brackets must balance, escaped brackets don't
// count, and code spans bind tighter than brackets, so `[`f([x])`](u)` and
// badge links like `[![npm](img)](url)` close at their final `]`.
function findClosingBracket(source: string, openBracketIndex: number, end: number) {
  let depth = 0;

  for (let index = openBracketIndex + 1; index < end; index += 1) {
    const character = source[index];

    if (character === "\\") {
      index += 1;
    } else if (character === "[") {
      depth += 1;
    } else if (character === "]") {
      if (depth === 0) {
        return index;
      }
      depth -= 1;
    } else if (character === codeSpanDelimiter.delimiter) {
      const delimiter = resolveOpeningDelimiter(source, index, codeSpanDelimiter);
      const closeIndex = source.indexOf(delimiter, index + delimiter.length);

      if (closeIndex >= 0 && closeIndex < end) {
        index = closeIndex + delimiter.length - 1;
      }
    }
  }

  return -1;
}

// Returns the first occurrence of `sequence` at or after `start` and before
// `end`, skipping any position whose preceding character is a backslash escape.
function findUnescapedSequence(source: string, sequence: string, start: number, end: number) {
  for (let index = start; index < end; index += 1) {
    if (source[index] === "\\") {
      index += 1;
      continue;
    }

    if (source.startsWith(sequence, index)) {
      return index;
    }
  }

  return -1;
}

function skipWhitespace(source: string, index: number, end: number) {
  while (index < end && source[index]! <= " ") {
    index += 1;
  }

  return index;
}

function unescapeMarkdownText(value: string) {
  return value.replace(markdownTextEscape, "$1");
}
