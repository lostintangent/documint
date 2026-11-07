/**
 * Owns link reference definitions: reading them off the start of a
 * paragraph, matching labels as CommonMark does, and resolving full
 * (`[text][label]`), collapsed (`[text][]`), and shortcut (`[text]`)
 * references against them. Documint has no reference node, so a resolved
 * reference becomes an ordinary link or image, and its definition is dropped
 * on save.
 */

import type { MarkdownParseContext } from "./context";

const labelWhitespace = /[ \t\r\n]+/g;

// Consumes the link reference definitions that open a paragraph's text and
// returns the text left after them, which is empty when the paragraph held
// nothing else.
export function readLinkReferenceDefinitions(text: string, context: MarkdownParseContext) {
  let index = 0;
  let definition;

  while ((definition = readLinkReferenceDefinition(text, index))) {
    const label = normalizeLinkLabel(definition.label);

    if (!context.linkReferences.has(label)) {
      context.linkReferences.set(label, { title: definition.title, url: definition.url });
    }

    index = definition.end;
  }

  return text.slice(index);
}

// Resolves the reference that follows link text spanning `textStart` to the
// `]` at `textEnd`. A full reference whose label isn't defined doesn't fall
// back to a shortcut, as in CommonMark, so `[a][b]` stays text without `b`.
export function readLinkReference(
  source: string,
  textStart: number,
  textEnd: number,
  end: number,
  context: MarkdownParseContext,
) {
  const labelEnd = source[textEnd + 1] === "[" ? findLinkLabelEnd(source, textEnd + 1, end) : -1;
  const isFullReference = labelEnd > textEnd + 2;

  if (!isFullReference && findLinkLabelEnd(source, textStart - 1, textEnd + 1) !== textEnd) {
    return null;
  }

  const label = isFullReference
    ? source.slice(textEnd + 2, labelEnd)
    : source.slice(textStart, textEnd);
  const definition = context.linkReferences.get(normalizeLinkLabel(label));

  if (!definition) {
    return null;
  }

  return {
    end: (labelEnd < 0 ? textEnd : labelEnd) + 1,
    title: definition.title,
    url: definition.url,
  };
}

// Labels match case-insensitively with inner whitespace collapsed, as in
// commonmark.js. Lower-then-upper casing folds forms like `ẞ` and `ss` together.
function normalizeLinkLabel(label: string) {
  return label.trim().replace(labelWhitespace, " ").toLowerCase().toUpperCase();
}

function readLinkReferenceDefinition(text: string, start: number) {
  const labelStart = skipSpacesAndTabs(text, start);
  const labelEnd = text[labelStart] === "[" ? findLinkLabelEnd(text, labelStart, text.length) : -1;

  if (labelEnd < 0 || text[labelEnd + 1] !== ":") {
    return null;
  }

  const label = text.slice(labelStart + 1, labelEnd);
  const afterColon = skipSpacesAndTabs(text, labelEnd + 2);
  const destinationStart =
    text[afterColon] === "\n" ? skipSpacesAndTabs(text, afterColon + 1) : afterColon;
  const destination = label.trim() && readLinkDestinationText(text, destinationStart, text.length);

  if (!destination) {
    return null;
  }

  // A title needs whitespace before it and may start on the next line. When
  // anything but spaces follows it, the definition ends at its destination.
  const rest =
    /(?:(?=[ \t\n])[ \t]*(?:\n[ \t]*)?("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\((?:\\.|[^()\\])*\)))?[ \t]*(?:\n|$)/sy;
  rest.lastIndex = destination.end;
  const match = rest.exec(text);

  return (
    match && {
      end: rest.lastIndex,
      label,
      title: match[1] ? unescapePunctuation(match[1].slice(1, -1)) : null,
      url: unescapePunctuation(destination.text),
    }
  );
}

// Reads the destination at `start`, returning its end and still-escaped text,
// or null when there's none. A `<...>` destination may hold spaces, but no line
// ending or unescaped `<`, and a bare one is empty only before `)`.
export function readLinkDestinationText(source: string, start: number, end: number) {
  if (source[start] === "<") {
    const pointed = /<((?:\\.|[^\\\n<>])*)>/sy;
    pointed.lastIndex = start;
    const text = pointed.exec(source)?.[1];
    return text === undefined || pointed.lastIndex > end ? null : { end: pointed.lastIndex, text };
  }

  const destinationEnd = findLinkDestinationEnd(source, start, end);
  return destinationEnd > start || source[start] === ")"
    ? { end: destinationEnd, text: source.slice(start, destinationEnd) }
    : null;
}

// Returns where a bare destination starting at `start` ends: at whitespace or
// at a `)` without an open `(` before it. Unescaped parentheses may nest when
// balanced, as in Wikipedia URLs, and a `(` left open returns -1.
function findLinkDestinationEnd(source: string, start: number, end: number) {
  let depth = 0;
  let index = start;

  for (; index < end; index += 1) {
    const character = source[index]!;

    if (character <= " ") {
      break;
    }

    if (character === "\\") {
      index += 1;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      if (depth === 0) {
        break;
      }
      depth -= 1;
    }
  }

  return depth === 0 ? index : -1;
}

// Returns the `]` closing the label opened at `openIndex`, or -1 when the
// label holds an unescaped bracket or runs past CommonMark's 999 characters.
function findLinkLabelEnd(source: string, openIndex: number, end: number) {
  const limit = Math.min(end, openIndex + 1001);

  for (let index = openIndex + 1; index < limit; index += 1) {
    const character = source[index];

    if (character === "\\") {
      index += 1;
    } else if (character === "[") {
      return -1;
    } else if (character === "]") {
      return index;
    }
  }

  return -1;
}

function skipSpacesAndTabs(text: string, index: number) {
  while (text[index] === " " || text[index] === "\t") {
    index += 1;
  }

  return index;
}

function unescapePunctuation(value: string) {
  return value.replace(/\\([!-/:-@[-`{-~])/g, "$1");
}
