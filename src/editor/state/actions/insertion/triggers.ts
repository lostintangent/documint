import {
  createBlockquoteBlock,
  createDividerBlock,
  createHeadingTextBlock,
  createListBlock,
  createListItemBlock,
  createParagraphTextBlock,
  rebuildListBlock,
  type HeadingBlock,
} from "@/document";
import type { DocumentIndex, EditorRegion } from "../../index/types";
import type { EditorStateAction } from "../../types";
import {
  createDescendantPrimaryRegionTarget,
  createRootPrimaryRegionTarget,
  normalizeSelection,
  type EditorSelection,
} from "../../selection";
import {
  replaceListItemLeadingParagraphText,
  resolveListItemContext,
  resolveRootTextBlockContext,
  type ListItemContext,
} from "../../context";

// Markdown-shortcut trigger system.
//
// Most insertions splice the typed characters into the current
// selection. A small set of *trigger syntaxes* upgrade an insertion
// into a structural edit instead — typing `# ` in an empty paragraph
// creates a heading; typing `1. ` in a bullet item rewrites the list
// as ordered; etc.
//
// Triggers are grouped by the cursor context they fire in. The entry
// point resolves that context once, then walks only the relevant
// group — we never match patterns that can't possibly apply here.
//
//   - root-paragraph  → CREATE a structural block (heading, list,
//                       blockquote, divider).
//   - heading         → TRANSFORM heading depth.
//   - list-item       → TRANSFORM list shape (bullet / ordered / task).
//
// All trigger patterns are precompiled at module load. The hot path
// on a typical keystroke is: a region lookup, a block-type field
// check, a single context resolution, and (for root-paragraph) a
// single-character whitespace precheck before any regex walk.

export function resolveInsertionTrigger(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  text: string,
): EditorStateAction | null {
  // Cross-region selections have no sensible trigger interpretation:
  // the post-replacement text would only contain the inserted
  // characters, dropping anything from the spanned regions.
  if (selection.anchor.regionId !== selection.focus.regionId) {
    return null;
  }

  const region = documentIndex.regionIndex.get(selection.anchor.regionId);
  if (!region) {
    return null;
  }

  // Field-level precheck via `region.blockType`: code blocks, table
  // cells, dividers, etc. resolve no context and produce no trigger.
  const context = resolveTriggerContext(documentIndex, selection, region);
  if (!context) {
    return null;
  }

  const { start, end } = resolveInsertionRange(documentIndex, selection);
  return matchTriggerForContext(region, text, start, end, context);
}

// ---- Selection range -------------------------------------------------------

// Same-region post-insertion endpoints. Skips the `normalizeSelection`
// allocation for the collapsed-cursor path (the dominant case while
// typing).
function resolveInsertionRange(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): { start: number; end: number } {
  if (selection.anchor.offset === selection.focus.offset) {
    return { start: selection.anchor.offset, end: selection.anchor.offset };
  }
  const normalized = normalizeSelection(documentIndex, selection);
  return { start: normalized.start.offset, end: normalized.end.offset };
}

// ---- Context resolution ----------------------------------------------------

type RootIndexContext = { rootIndex: number };

type TriggerContext =
  | ({ kind: "root-paragraph" } & RootIndexContext)
  | ({ kind: "heading" } & RootIndexContext)
  | { kind: "list-item"; item: ListItemContext };

function resolveTriggerContext(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  region: EditorRegion,
): TriggerContext | null {
  // Triggers can only fire inside paragraph and heading regions.
  // Everything else (code, table cells, dividers, …) splices without
  // further work.
  switch (region.blockType) {
    case "heading": {
      // Confirm the heading is at root level — `resolveRootTextBlockContext`
      // returns null for non-root blocks (e.g. nested in containers), and
      // a non-root heading has no sensible depth-change transform.
      const rootBlock = resolveRootTextBlockContext(documentIndex, selection);
      return rootBlock?.block.type === "heading"
        ? { kind: "heading", rootIndex: rootBlock.rootIndex }
        : null;
    }
    case "paragraph": {
      // Try list-item first: the cursor inside a list item's paragraph
      // wouldn't surface via the root-text-block resolver anyway.
      const listItem = resolveListItemContext(documentIndex, selection);
      if (listItem) {
        return { kind: "list-item", item: listItem };
      }
      const rootBlock = resolveRootTextBlockContext(documentIndex, selection);
      return rootBlock?.block.type === "paragraph"
        ? { kind: "root-paragraph", rootIndex: rootBlock.rootIndex }
        : null;
    }
    default:
      return null;
  }
}

// ---- Trigger dispatch ------------------------------------------------------

function matchTriggerForContext(
  region: EditorRegion,
  text: string,
  start: number,
  end: number,
  context: TriggerContext,
): EditorStateAction | null {
  // Root-paragraph create patterns are anchored `^…\s$`: the entire
  // prospective text must end in whitespace. Check that without
  // building the prospective string, so the dominant typing case
  // (non-whitespace character anywhere in a paragraph) skips both the
  // string allocation and the regex walk entirely.
  if (
    context.kind === "root-paragraph" &&
    !prospectiveEndsWithWhitespace(region, text, end)
  ) {
    return null;
  }

  const prospectiveText = region.text.slice(0, start) + text + region.text.slice(end);

  switch (context.kind) {
    case "root-paragraph":
      return matchAndApply(ROOT_PARAGRAPH_TRIGGERS, prospectiveText, context);
    case "heading":
      return matchAndApply(HEADING_TRIGGERS, prospectiveText, context);
    case "list-item":
      return matchAndApply(LIST_ITEM_TRIGGERS, prospectiveText, context.item);
  }
}

// The last character of `region.text.slice(0, start) + text + region.text.slice(end)`
// is determined by whichever side of the splice is non-empty at the tail:
//   - cursor not at end of region → suffix is non-empty → region's last char wins
//   - cursor at end of region     → suffix is empty     → text's last char wins
function prospectiveEndsWithWhitespace(
  region: EditorRegion,
  text: string,
  end: number,
): boolean {
  const tail = end < region.text.length ? region.text : text;
  return tail.length > 0 && /\s/.test(tail[tail.length - 1]!);
}

type Trigger<C> = {
  pattern: RegExp;
  apply: (match: RegExpExecArray, context: C) => EditorStateAction | null;
};

function matchAndApply<C>(
  triggers: readonly Trigger<C>[],
  prospectiveText: string,
  context: C,
): EditorStateAction | null {
  for (const { pattern, apply } of triggers) {
    const match = pattern.exec(prospectiveText);
    if (match) {
      return apply(match, context);
    }
  }
  return null;
}

// ---- Trigger definitions ---------------------------------------------------

// Each pattern anchors on a distinct leading character (`#`, `[-+*]`,
// digit, `[`, `>`, `-`), so the patterns are mutually exclusive and
// the order within this list is just for readability.
//
// Task-list deliberately does NOT include a leading `[-+*]` marker:
// bullet-list would always pre-empt it on the per-keystroke path
// (typing `- ` triggers bullet creation before you can finish typing
// `- [ ] `). Anchoring task on the bracket lets it stand on its own.
//
// Thematic break only triggers on `---` (the canonical form the
// serializer emits) even though the parser also accepts `***` and
// `___` for interop. New documents should converge on one syntax.
const ROOT_PARAGRAPH_TRIGGERS: readonly Trigger<RootIndexContext>[] = [
  {
    // Task list: `[ ] ` / `[x] ` / `[]` (with optional leading indent).
    pattern: compileCreatePattern(/\[[ xX]?\]/, { allowIndent: true }),
    apply: (match, { rootIndex }) =>
      createListAction(rootIndex, {
        checked: match[1]!.toLowerCase().includes("x"),
        ordered: false,
        start: null,
      }),
  },
  {
    // Bullet list: `- ` / `+ ` / `* ` (with optional leading indent).
    pattern: compileCreatePattern(/[-+*]/, { allowIndent: true }),
    apply: (_, { rootIndex }) =>
      createListAction(rootIndex, { checked: null, ordered: false, start: null }),
  },
  {
    // Ordered list: `1. ` / `42. ` (with optional leading indent).
    pattern: compileCreatePattern(/\d+\./, { allowIndent: true }),
    apply: (match, { rootIndex }) =>
      createListAction(rootIndex, {
        checked: null,
        ordered: true,
        start: Number(match[1]!.slice(0, -1)),
      }),
  },
  {
    // Heading: `# ` through `###### `.
    pattern: compileCreatePattern(/#{1,6}/, { allowIndent: false }),
    apply: (match, { rootIndex }) => ({
      kind: "splice-blocks",
      blocks: [
        createHeadingTextBlock({
          depth: match[1]!.length as HeadingBlock["depth"],
          text: "",
        }),
      ],
      rootIndex,
      selection: createRootPrimaryRegionTarget(rootIndex),
    }),
  },
  {
    // Blockquote: `> `.
    pattern: compileCreatePattern(/>/, { allowIndent: false }),
    apply: (_, { rootIndex }) => ({
      kind: "splice-blocks",
      blocks: [
        createBlockquoteBlock({ children: [createParagraphTextBlock({ text: "" })] }),
      ],
      rootIndex,
      selection: createDescendantPrimaryRegionTarget(rootIndex, [0]),
    }),
  },
  {
    // Thematic break: `--- `.
    pattern: compileCreatePattern(/---/, { allowIndent: false }),
    apply: (_, { rootIndex }) => ({
      kind: "splice-blocks",
      blocks: [createDividerBlock(), createParagraphTextBlock({ text: "" })],
      rootIndex,
      selection: createRootPrimaryRegionTarget(rootIndex + 1),
    }),
  },
];

const HEADING_TRIGGERS: readonly Trigger<RootIndexContext>[] = [
  {
    // Change heading depth by typing `#`s in front of existing heading text.
    pattern: compileTransformPattern(/#{1,6}/),
    apply: (match, { rootIndex }) => ({
      kind: "splice-blocks",
      blocks: [
        createHeadingTextBlock({
          depth: match[1]!.length as HeadingBlock["depth"],
          text: match[2]!,
        }),
      ],
      rootIndex,
      selection: createRootPrimaryRegionTarget(rootIndex),
    }),
  },
];

// Patterns anchor on distinct leading characters (`[-+*]`, digit, `[`),
// so they're mutually exclusive and the order within this list is just
// for readability. See the task-list note in `ROOT_PARAGRAPH_TRIGGERS`
// for why task triggers off `[` rather than `[-+*]`.
const LIST_ITEM_TRIGGERS: readonly Trigger<ListItemContext>[] = [
  {
    // Convert to ordered list, preserving existing checked state.
    pattern: compileTransformPattern(/\d+\./),
    apply: (match, ctx) =>
      transformListAction(match, ctx, {
        ordered: true,
        start: 1,
        checked: ctx.item.checked,
      }),
  },
  {
    // Convert to task list, reading the checkbox state from the typed marker.
    pattern: compileTransformPattern(/\[[ xX]?\]/),
    apply: (match, ctx) =>
      transformListAction(match, ctx, {
        ordered: false,
        start: null,
        checked: match[1]!.toLowerCase().includes("x"),
      }),
  },
  {
    // Convert to bullet list, clearing checked state.
    pattern: compileTransformPattern(/[-+*]/),
    apply: (match, ctx) =>
      transformListAction(match, ctx, { ordered: false, start: null, checked: null }),
  },
];

// ---- Pattern compilation (runs once, at module load) -----------------------

function compileCreatePattern(body: RegExp, options: { allowIndent: boolean }): RegExp {
  // Entire region (modulo optional indent) must be the trigger followed by
  // a single terminating whitespace; nothing else.
  const leading = options.allowIndent ? "\\s*" : "";
  return new RegExp(`^${leading}(${body.source})\\s$`);
}

function compileTransformPattern(body: RegExp): RegExp {
  // Region begins with the trigger plus whitespace; everything after the
  // whitespace is preserved as the new block's text content.
  return new RegExp(`^\\s*(${body.source})\\s(.+)$`);
}

// ---- Shared action factories -----------------------------------------------

function createListAction(
  rootIndex: number,
  options: { checked: boolean | null; ordered: boolean; start: number | null },
): EditorStateAction {
  return {
    kind: "splice-blocks",
    blocks: [
      createListBlock({
        items: [
          createListItemBlock({
            checked: options.checked,
            children: [createParagraphTextBlock({ text: "" })],
            spread: false,
          }),
        ],
        ordered: options.ordered,
        spread: false,
        start: options.start,
      }),
    ],
    rootIndex,
    selection: createDescendantPrimaryRegionTarget(rootIndex, [0, 0]),
  };
}

// Returns null when the list item's leading paragraph can't be rewritten
// (e.g. its first child is a nested list rather than a paragraph). Callers
// fall through to a plain splice in that case.
function transformListAction(
  match: RegExpExecArray,
  context: ListItemContext,
  options: { ordered: boolean; start: number | null; checked: boolean | null },
): EditorStateAction | null {
  const updatedItem = replaceListItemLeadingParagraphText(context.item, match[2]!);
  if (!updatedItem) {
    return null;
  }

  return {
    kind: "replace-block",
    block: rebuildListBlock(
      context.list,
      context.list.items.map((item, index) =>
        index === context.itemIndex ? { ...updatedItem, checked: options.checked } : item,
      ),
      { ordered: options.ordered, start: options.start },
    ),
    blockId: context.list.id,
    selection: createDescendantPrimaryRegionTarget(context.rootIndex, [
      ...context.listChildIndices,
      context.itemIndex,
      0,
    ]),
  };
}
