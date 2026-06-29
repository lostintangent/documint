import {
  createBlockquoteBlock,
  createDividerBlock,
  createHeadingTextBlock,
  createListBlock,
  createListItemBlock,
  createParagraphTextBlock,
  rebuildListBlock,
  type Block,
  type HeadingBlock,
} from "@/document";
import type { DocumentIndex, EditableRegion } from "../../../index/types";
import { resolveRegion } from "../../../index/query";
import type { EditorStateAction } from "../../../types";
import { normalizeSelection, target, type EditorSelection } from "../../../selection";
import {
  replaceListItemLeadingParagraphText,
  resolveListItemContextFromSelection,
  resolveRootTextBlockContextFromSelection,
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
  if (selection.anchor.regionPath !== selection.focus.regionPath) {
    return null;
  }

  const region = resolveRegion(documentIndex, selection.anchor.regionPath);
  if (!region) {
    return null;
  }

  // Field-level precheck via `region.block.type`: code blocks, table
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
  region: EditableRegion,
): TriggerContext | null {
  // Triggers can only fire inside paragraph and heading regions.
  // Everything else (code, table cells, dividers, …) splices without
  // further work.
  switch (region.block.type) {
    case "heading": {
      // Confirm the heading is at root level — `resolveRootTextBlockContextFromSelection`
      // returns null for non-root blocks (e.g. nested in containers), and
      // a non-root heading has no sensible depth-change transform.
      const rootBlock = resolveRootTextBlockContextFromSelection(documentIndex, selection);
      return rootBlock?.block.type === "heading"
        ? { kind: "heading", rootIndex: rootBlock.rootIndex }
        : null;
    }
    case "paragraph": {
      // Try list-item first: the cursor inside a list item's paragraph
      // wouldn't surface via the root-text-block resolver anyway.
      const listItem = resolveListItemContextFromSelection(documentIndex, selection);
      if (listItem) {
        return { kind: "list-item", item: listItem };
      }
      const rootBlock = resolveRootTextBlockContextFromSelection(documentIndex, selection);
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
  region: EditableRegion,
  text: string,
  start: number,
  end: number,
  context: TriggerContext,
): EditorStateAction | null {
  // Markdown shortcuts fire when the inserted text supplies the completing
  // whitespace. A pre-existing suffix space must not turn a typed marker into
  // a structural trigger after Enter splits before hidden whitespace.
  if (text.length === 0 || !/\s/.test(text[text.length - 1]!)) {
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

// Most patterns anchor on a distinct leading character (`#`, `[-+*]`,
// digit, `[`, `>`, `-`), so the order within this list is mostly for
// readability. Task-list supports both the lightweight `[ ] ` trigger
// and the canonical markdown `- [ ] ` form that bulk insertions use, so
// it must run before bullet-list.
//
// Per-keystroke task-list creation still uses the bracket form: typing
// `- ` creates a bullet list before you can finish typing `- [ ] `.
// Bulk insertion can provide the full canonical marker at once.
//
// Thematic break only triggers on `---` (the canonical form the
// serializer emits) even though the parser also accepts `***` and
// `___` for interop. New documents should converge on one syntax.
const ROOT_PARAGRAPH_TRIGGERS: readonly Trigger<RootIndexContext>[] = [
  {
    // Task list: `[ ] ` / `[x] ` / `[]` or `- [ ] ` / `- [x] ` / `- []`
    // (with optional leading indent).
    pattern: compileCreatePattern(/(?:[-+*]\s+)?\[[ xX]?\]/, { allowIndent: true }),
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
    apply: (match, { rootIndex }) =>
      createHeadingAction(rootIndex, match[1]!.length as HeadingBlock["depth"], ""),
  },
  {
    // Blockquote: `> `.
    pattern: compileCreatePattern(/>/, { allowIndent: false }),
    apply: (_, { rootIndex }) => createBlockquoteAction(rootIndex),
  },
  {
    // Thematic break: `--- `.
    pattern: compileCreatePattern(/---/, { allowIndent: false }),
    apply: (_, { rootIndex }) => createDividerAction(rootIndex),
  },
];

const HEADING_TRIGGERS: readonly Trigger<RootIndexContext>[] = [
  {
    // Change heading depth by typing `#`s in front of existing heading text.
    pattern: compileTransformPattern(/#{1,6}/),
    apply: (match, { rootIndex }) =>
      createHeadingAction(rootIndex, match[1]!.length as HeadingBlock["depth"], match[2]!),
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

// ---- Trigger action factories ----------------------------------------------

function createHeadingAction(
  rootIndex: number,
  depth: HeadingBlock["depth"],
  text: string,
): EditorStateAction {
  const heading = createHeadingTextBlock({ depth, text });

  return replaceRootWithBlocks(rootIndex, [heading], heading);
}

function createBlockquoteAction(rootIndex: number): EditorStateAction {
  const paragraph = createParagraphTextBlock("");

  return replaceRootWithBlocks(rootIndex, [createBlockquoteBlock([paragraph])], paragraph);
}

function createDividerAction(rootIndex: number): EditorStateAction {
  const paragraph = createParagraphTextBlock("");

  return replaceRootWithBlocks(rootIndex, [createDividerBlock(), paragraph], paragraph);
}

function createListAction(
  rootIndex: number,
  options: { checked: boolean | null; ordered: boolean; start: number | null },
): EditorStateAction {
  const paragraph = createParagraphTextBlock("");

  return replaceRootWithBlocks(
    rootIndex,
    [
      createListBlock({
        items: [
          createListItemBlock({
            checked: options.checked,
            children: [paragraph],
          }),
        ],
        ordered: options.ordered,
        start: options.start,
      }),
    ],
    paragraph,
  );
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

  const transformedItem = { ...updatedItem, checked: options.checked };

  return {
    kind: "replace-block",
    block: rebuildListBlock(
      context.list,
      context.list.items.map((item, index) =>
        index === context.itemIndex ? transformedItem : item,
      ),
      { ordered: options.ordered, start: options.start },
    ),
    blockPath: context.listPath,
    selection: target.block(transformedItem),
  };
}

function replaceRootWithBlocks(
  rootIndex: number,
  blocks: Block[],
  caret: Block,
): EditorStateAction {
  return {
    kind: "splice-blocks",
    blocks,
    rootIndex,
    selection: target.block(caret),
  };
}
