/**
 * Serializes semantic inline nodes into the canonical Documint markdown
 * dialect. Used by the block serializers for every text-bearing block, by
 * table-cell serialization, and by the fragment bridge when the clipboard
 * payload is inline content.
 */

import { defragmentTextInlines, type Inline, type Mark } from "@/document";
import {
  codePointAt,
  codePointBefore,
  inlineMarkSyntaxByMark,
  resolveEmphasisFlanking,
} from "../shared";

// --- Escape patterns ---
// Mirror the inverse-escape patterns in `parser/inlines.ts`. The serializer
// escapes a deliberately narrower set than the parser unescapes — the parser
// is permissive about authored backslashes, but emission only needs to escape
// the characters that would otherwise flip the parse on the next round-trip:
// `_` except inside a word, where it can't open or close emphasis, `~` only
// in runs of exactly two, which delimit strikethrough (longer runs stay bare,
// so an unsupported `~~~` fence keeps rendering as one), `<` only where it
// would open a tag, comment, or autolink, and `{` only after a `:name`, where
// it would open a text directive's attributes.
const markdownTextEscapePattern =
  /((?<=[\p{L}\p{N}])_+(?=[\p{L}\p{N}]))|[\\`*_[\]]|(?<!~)~(?=~(?!~))|(?<=(?<!~)~)~(?!~)|<(?=[A-Za-z/!?])|(?<=:[A-Za-z][-\w]*)\{/gu;
const markdownDestinationEscapePattern = /([\\()<>])/g;
const markdownTitleEscapePattern = /(["\\])/g;
// Plain prose has none of these, so `escapeMarkdownText` skips its replace.
const markdownTextMetaProbe = /[\\`*_[\]~<{]/;
const linkSeamCharacter = /[@!]$/;
const edgeWhitespace = /^(\s*)(.*?)(\s*)$/su;

const noMarks: readonly Mark[] = [];

export function serializeInlines(nodes: Inline[]): string {
  return serializeInlineRange(defragmentTextInlines(nodes), noMarks);
}

// `inherited` marks are already open around the range, as for a link label
// inside a lifted mark.
function serializeInlineRange(nodes: Inline[], inherited: readonly Mark[]): string {
  const segments = nodes.map((node, index) => {
    const marks =
      node.type === "text" ? node.marks : node.type === "link" ? liftLinkMarks(node) : null;
    return {
      markdown: serializeInline(node, nodes[index + 1]),
      marks: marks && spanMarks(marks, inherited),
    };
  });

  if (!segments.some((segment) => segment.marks?.length)) {
    return segments.map((segment) => segment.markdown).join("");
  }

  resolveAtomMarks(segments);
  const parts = emitMarkSpans(hoistEdgeWhitespace(segments));
  resolveEmphasisFallbacks(parts);
  return parts.map(renderPart).join("");
}

function serializeInline(node: Inline, nextNode?: Inline): string {
  switch (node.type) {
    case "lineBreak":
      // Only `<br>` survives formatters, trailing-whitespace hooks and
      // single-line table rows. The parser eats a following `\n`.
      return "<br>";
    case "image":
      return serializeImage(node);
    case "mention":
      return `@[${escapeMarkdownText(node.name)}](${escapeMarkdownDestination(node.userId)})`;
    case "resource":
      return `[${escapeMarkdownText(node.label)}]${serializeLinkDestination(node.url, null)}`;
    case "link":
      return serializeLink(node);
    case "text":
      return node.marks.includes("code")
        ? serializeCodeSpan(node.text)
        : escapeMarkdownText(node.text, nextNode);
    case "raw":
      return node.source;
  }
}

// --- Mark spans ---
// Marks are written as spans over runs of inline nodes rather than per node,
// so `*see `code` here*` stays one emphasis instead of three. A range is cut
// into segments (text, links and atoms), each carrying the span marks it
// needs, and a stack opens and closes spans at segment boundaries. Code is
// literal content rather than a span, so it stays on its own text.

type Segment = {
  markdown: string;
  // `null` for an atom until `resolveAtomMarks` gives it its neighbors' marks.
  marks: readonly Mark[] | null;
};

// `openRun` is the length of the `*` run that opened the span, which the rule
// of 3 reads.
type MarkSpan = { asTag: boolean; mark: Mark; openRun: number };
type SpanEdge = { opening: boolean; span: MarkSpan };
type Part = string | SpanEdge;

function spanMarks(marks: readonly Mark[], inherited: readonly Mark[]) {
  return marks.filter((mark) => mark !== "code" && !inherited.includes(mark));
}

// A link's shared marks are written around it, as `**[docs](url)**`, so a span
// covering the link and its neighbors stays one span. A link without text has
// none and is transparent like an atom.
function liftLinkMarks(link: Extract<Inline, { type: "link" }>): readonly Mark[] | null {
  let lifted: readonly Mark[] | null = null;

  for (const child of link.children) {
    if (child.type === "text" && child.text.length > 0) {
      const marks = spanMarks(child.marks, noMarks);
      lifted = lifted ? lifted.filter((mark) => marks.includes(mark)) : marks;
    }
  }

  return lifted;
}

// Atoms (images, mentions, resources, breaks, raw HTML) carry no marks, so
// they take the marks their nearest neighbors share and don't split a span
// that runs across them, as in `**bold <img> more**`.
function resolveAtomMarks(segments: Segment[]) {
  let next: readonly Mark[] | undefined;

  segments.forEach((segment, index) => {
    if (segment.marks) {
      next = undefined;
      return;
    }

    next ??= segments.slice(index + 1).find((later) => later.marks)?.marks ?? noMarks;
    segment.marks = (segments[index - 1]?.marks ?? noMarks).filter((mark) => next!.includes(mark));
  });
}

// Emphasis can't open before or close after whitespace, so whitespace at the
// edge of bold or italic text moves outside the span: `**bold** text` rather
// than `**bold **text`. Other marks keep it, since it shows under a
// strikethrough or underline.
function hoistEdgeWhitespace(segments: Segment[]): Segment[] {
  return segments.flatMap((segment, index) => {
    const marks = segment.marks!;

    if (!marks.some(isEmphasisMark)) {
      return [segment];
    }

    const [, leading, body, trailing] = edgeWhitespace.exec(segment.markdown)!;
    const keepOutside = (neighbor: Segment | undefined) =>
      marks.filter((mark) => !isEmphasisMark(mark) || neighbor?.marks!.includes(mark));
    const before = keepOutside(segments[index - 1]);
    const after = keepOutside(segments[index + 1]);

    return [
      { markdown: leading!, marks: before },
      { ...segment, markdown: body },
      { markdown: trailing!, marks: after },
    ].filter((part) => part.markdown);
  });
}

function isEmphasisMark(mark: Mark) {
  return inlineMarkSyntaxByMark[mark].kind === "emphasis";
}

// Spans stay well nested: a boundary closes every span from the lowest one the
// next segment lacks, then opens the missing marks with the longest-running
// outermost, so `**a *b***` needs no reopening. Equal runs put the higher
// ranked mark outside, as in `~~**x**~~`. A trailing unmarked segment closes
// the spans still open.
function emitMarkSpans(segments: Segment[]): Part[] {
  const parts: Part[] = [];
  const stack: MarkSpan[] = [];

  [...segments, { markdown: "", marks: noMarks }].forEach((segment, index) => {
    const marks = segment.marks!;
    const depth = stack.findIndex((span) => !marks.includes(span.mark));
    while (depth >= 0 && stack.length > depth) {
      parts.push({ opening: false, span: stack.pop()! });
    }

    const runLength = (mark: Mark) => {
      let end = index;
      while (segments[end]?.marks!.includes(mark)) end += 1;
      return end - index;
    };
    const opening = marks
      .filter((mark) => !stack.some((span) => span.mark === mark))
      .reverse()
      .sort((left, right) => runLength(right) - runLength(left));

    for (const mark of opening) {
      const span = { asTag: false, mark, openRun: 0 };
      stack.push(span);
      parts.push({ opening: true, span });
    }

    parts.push(segment.markdown);
  });

  return parts;
}

// --- Emphasis fallback ---
// A `*` run only reparses as written where CommonMark's flanking rules let it
// open or close, so `a**(b)**c` can't be written with asterisks. Each run of
// adjacent `*` delimiters is checked against its neighbors, and the spans it
// can't open or close fall back to `<strong>`/`<em>`, which bind anywhere. A
// fallback changes its neighbors' runs, so the check repeats until stable.
//
// Bold and italic don't nest in themselves, so a run that only opens or only
// closes never trips the rule of 3. Two hazards remain. A run that can both
// open and close first closes the `*` span open in its range. A run that
// closes and reopens, like the `****` in `**a*b****c*`, can trip the rule of 3.
// `~~`, HTML tags and link labels each parse their content as a separate range.
function resolveEmphasisFallbacks(parts: Part[]) {
  for (let changed = true; changed;) {
    changed = false;
    const stack: MarkSpan[] = [];
    let index = 0;

    while (index < parts.length) {
      const part = parts[index]!;

      if (!isEmphasisDelimiter(part)) {
        if (typeof part === "object" && part.opening) stack.push(part.span);
        else if (typeof part === "object") stack.pop();
        index += 1;
        continue;
      }

      const runStart = index;
      const closers: MarkSpan[] = [];
      const openers: MarkSpan[] = [];
      let length = 0;

      for (let edge: Part | undefined = part; isEmphasisDelimiter(edge); edge = parts[++index]) {
        const { opening, span } = edge as SpanEdge;
        (opening ? openers : closers).push(span);
        length += renderPart(edge!).length;
      }

      const previous = renderPart(parts[runStart - 1] ?? "");
      const next = renderPart(parts[index] ?? "");
      const { canClose, canOpen } = resolveEmphasisFlanking(
        "*",
        codePointBefore(previous, previous.length),
        codePointAt(next, 0),
      );

      stack.length -= closers.length;

      const fallbacks =
        closers.length > 0 && !canClose
          ? closers
          : openers.length > 0 &&
              (!canOpen ||
                (closers.length > 0 && length > 3) ||
                (canClose && closesOpenEmphasis(stack.at(-1), length)))
            ? openers
            : [];

      for (const span of fallbacks) span.asTag = true;
      for (const span of openers) span.openRun = length;
      changed ||= fallbacks.length > 0;
      stack.push(...openers);
    }
  }
}

function isEmphasisDelimiter(part: Part | undefined) {
  return typeof part === "object" && !part.span.asTag && isEmphasisMark(part.span.mark);
}

// Whether a run that can both open and close would close the `*` span open in
// its range. The rule of 3 keeps a lone `*` from closing a lone `**` and vice
// versa, which keeps `**a*b***` intact.
function closesOpenEmphasis(span: MarkSpan | undefined, length: number) {
  if (!span || span.asTag) {
    return false;
  }

  const syntax = inlineMarkSyntaxByMark[span.mark];
  return (
    syntax.kind === "emphasis" &&
    (span.openRun !== syntax.delimiter.length || (span.openRun + length) % 3 !== 0)
  );
}

function renderPart(part: Part): string {
  if (typeof part === "string") {
    return part;
  }

  const syntax = inlineMarkSyntaxByMark[part.span.mark];

  return syntax.kind === "html" || (syntax.kind === "emphasis" && part.span.asTag)
    ? `<${part.opening ? "" : "/"}${syntax.tags[0]}>`
    : syntax.delimiter;
}

// --- Inline nodes ---

function serializeCodeSpan(value: string) {
  const widestRun = value.match(/`+/g)?.reduce((widest, run) => Math.max(widest, run.length), 0);
  const fence = "`".repeat((widestRun ?? 0) + 1);
  const padded = value.startsWith("`") || value.endsWith("`") ? ` ${value} ` : value;
  return `${fence}${padded}${fence}`;
}

function serializeImage(node: Extract<Inline, { type: "image" }>) {
  const alt = escapeMarkdownText(node.alt ?? "");
  const destination = serializeLinkDestination(node.url, node.title);
  const width = node.width ? `{width=${node.width}}` : "";

  return `![${alt}]${destination}${width}`;
}

function serializeLink(node: Extract<Inline, { type: "link" }>) {
  const lifted = liftLinkMarks(node) ?? noMarks;
  const label = serializeInlineRange(defragmentTextInlines(node.children), lifted);
  return `[${label}]${serializeLinkDestination(node.url, node.title)}`;
}

// An empty destination before a title needs `<>`, or the title would read as
// the destination.
function serializeLinkDestination(url: string, title: string | null) {
  const destination = escapeMarkdownDestination(url) || (title ? "<>" : "");
  const quotedTitle = title ? ` "${title.replace(markdownTitleEscapePattern, "\\$1")}"` : "";
  return `(${destination}${quotedTitle})`;
}

// --- Low-level utilities ---

// Text escaping protects two round-trip hazards: ordinary markdown
// metacharacters (escaping `[` also keeps literal `@[...]` prose from parsing
// as a mention), and the seam where text ending in `@` or `!` sits before a
// `[label](url)` node and would synthesize mention or image syntax.
function escapeMarkdownText(value: string, nextNode?: Inline) {
  const escaped = markdownTextMetaProbe.test(value)
    ? value.replace(markdownTextEscapePattern, (match, word) => word ?? `\\${match}`)
    : value;

  return (nextNode?.type === "link" || nextNode?.type === "resource") &&
    linkSeamCharacter.test(escaped)
    ? `${escaped.slice(0, -1)}\\${escaped.slice(-1)}`
    : escaped;
}

// A destination with whitespace only reads back inside `<>`.
function escapeMarkdownDestination(value: string) {
  const escaped = value.replace(markdownDestinationEscapePattern, "\\$1");
  return /\s/.test(value) ? `<${escaped}>` : escaped;
}
