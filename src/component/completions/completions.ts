// Pure completion primitives shared by leaf inputs and document-level
// completion overlays. DOM anchoring, keyboard handling, and rendering stay
// with the caller.

export type CompletionItem = {
  label: string;
  id?: string;
  icon?: string;
  insertText?: string;
};

export type CompletionSource = {
  trigger: string;
  items: CompletionItem[];
};

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

function equalCompletionItems(previous: CompletionItem, next: CompletionItem) {
  return (
    previous.id === next.id &&
    previous.icon === next.icon &&
    previous.insertText === next.insertText &&
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

function isCompletionBoundary(char: string | undefined): boolean {
  return char === undefined || char === " " || char === "\n" || char === "\t";
}
