// Pure completion primitives shared by leaf inputs, document-level completion
// overlays, and text tokenization. DOM anchoring, keyboard handling, and
// rendering stay with the caller.

export type CompletionItem = {
  label: string;
  id?: string;
  icon?: string;
  insertText?: string;
  kind?: "mention";
};

export type CompletionSource = {
  trigger: string;
  items: CompletionItem[];
};

export type TriggerSegment =
  | { kind: "text"; text: string }
  | { kind: "token"; trigger: string; label: string; id?: string };

export type ActiveCompletion = {
  trigger: string;
  query: string;
  triggerStart: number;
  caret: number;
  matches: CompletionItem[];
};

export type CompletionInsertion = {
  caret: number;
  value: string;
};

const DEFAULT_COMPLETION_MATCH_LIMIT = 50;

export function sortCompletionSources(sources: CompletionSource[] | undefined): CompletionSource[] {
  if (!sources?.length) return [];
  return sources.map((source) => ({
    trigger: source.trigger,
    items: [...source.items].sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
    ),
  }));
}

export function equalCompletionSources(
  previous: CompletionSource | null | undefined,
  next: CompletionSource | null | undefined,
) {
  if (previous === next) return true;
  if (!previous || !next) return false;

  return (
    previous.trigger === next.trigger &&
    previous.items.length === next.items.length &&
    previous.items.every((item, index) => equalCompletionItems(item, next.items[index]!))
  );
}

export function equalCompletionItems(previous: CompletionItem, next: CompletionItem) {
  return (
    previous.id === next.id &&
    previous.icon === next.icon &&
    previous.insertText === next.insertText &&
    previous.kind === next.kind &&
    previous.label === next.label
  );
}

export function equalCompletionItemLists(
  previous: readonly CompletionItem[],
  next: readonly CompletionItem[],
) {
  return (
    previous.length === next.length &&
    previous.every((item, index) => equalCompletionItems(item, next[index]!))
  );
}

export function detectCompletionContext(
  value: string,
  caret: number,
  sources: CompletionSource[],
): ActiveCompletion | null {
  // Walk back from the caret looking for a trigger character. Stop early
  // on whitespace — that terminates any active completion context.
  for (let index = caret - 1; index >= 0; index -= 1) {
    const char = value[index];

    if (isCompletionBoundary(char)) {
      return null;
    }

    const source = sources.find((candidate) => candidate.trigger === char);
    if (!source) {
      continue;
    }

    // The trigger only counts if it sits at the start of the value or
    // immediately after whitespace — otherwise it's part of a word.
    if (index > 0 && !isCompletionBoundary(value[index - 1])) {
      return null;
    }

    const query = value.slice(index + 1, caret);
    return {
      trigger: source.trigger,
      query,
      triggerStart: index,
      caret,
      matches: filterCompletionItems(source.items, query),
    };
  }

  return null;
}

export function filterCompletionItems(items: CompletionItem[], query: string): CompletionItem[] {
  if (!query) return items.slice(0, DEFAULT_COMPLETION_MATCH_LIMIT);

  const needle = query.toLowerCase();
  const matches: CompletionItem[] = [];

  for (const item of items) {
    if (item.label.toLowerCase().includes(needle)) {
      matches.push(item);
      if (matches.length >= DEFAULT_COMPLETION_MATCH_LIMIT) {
        break;
      }
    }
  }

  return matches;
}

export function resolveCompletionInsertion(
  value: string,
  completion: ActiveCompletion,
  item: CompletionItem,
): CompletionInsertion {
  const insertion = resolveCompletionInsertionText(completion, item);
  const before = value.slice(0, completion.triggerStart);
  const after = value.slice(completion.caret);

  return {
    caret: completion.triggerStart + insertion.length,
    value: before + insertion + after,
  };
}

export function resolveCompletionInsertionText(completion: ActiveCompletion, item: CompletionItem) {
  return item.insertText ?? `${completion.trigger}${item.label} `;
}

// Split committed text into runs of plain content and trigger-prefixed tokens
// that match a completion source label. Used by renderers (to pill @mentions)
// and extractors (to pull out mentioned IDs). Labels within a source are
// matched longest-first so "Jane Doe" wins over "Jane" when both are present.
// A trigger only counts at the start of input or after whitespace, so
// "email@alice" is not treated as a token.
export function tokenizeTriggers(
  value: string,
  sources: CompletionSource[] | undefined,
): TriggerSegment[] {
  if (!sources?.length || !sources.some((source) => value.includes(source.trigger))) {
    return [{ kind: "text", text: value }];
  }

  const itemsByTrigger = new Map<string, CompletionSource["items"]>();
  for (const source of sources) {
    const sorted = [...source.items].sort((a, b) => b.label.length - a.label.length);
    itemsByTrigger.set(source.trigger, sorted);
  }

  const segments: TriggerSegment[] = [];
  let cursor = 0;
  let textStart = 0;

  while (cursor < value.length) {
    const char = value[cursor];
    const items = itemsByTrigger.get(char);
    const isTriggerCandidate =
      items !== undefined && (cursor === 0 || isCompletionBoundary(value[cursor - 1]));

    if (isTriggerCandidate) {
      const item = items.find((candidate) => {
        if (!value.startsWith(candidate.label, cursor + 1)) {
          return false;
        }

        return isTokenTerminator(value[cursor + 1 + candidate.label.length]);
      });
      if (item) {
        if (cursor > textStart) {
          segments.push({ kind: "text", text: value.slice(textStart, cursor) });
        }
        segments.push({ kind: "token", trigger: char, label: item.label, id: item.id });
        cursor += 1 + item.label.length;
        textStart = cursor;
        continue;
      }
    }

    cursor += 1;
  }

  if (textStart < value.length) {
    segments.push({ kind: "text", text: value.slice(textStart) });
  }

  return segments;
}

function isCompletionBoundary(char: string | undefined): boolean {
  return char === undefined || char === " " || char === "\n" || char === "\t";
}

function isTokenTerminator(char: string | undefined): boolean {
  return char === undefined || isCompletionBoundary(char) || !/[\p{L}\p{N}_]/u.test(char);
}
