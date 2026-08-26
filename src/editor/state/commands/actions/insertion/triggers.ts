import {
  createBlockquoteBlock,
  createDividerBlock,
  createHeadingBlock,
  createListBlock,
  createListItemBlock,
  rebuildListBlock,
  rebuildListItemBlock,
  rebuildTextBlock,
  type Block,
  type HeadingBlock,
  type ParagraphBlock,
} from "@/document";
import type { DocumentIndex } from "../../../index/types";
import { resolveEditorTextAtPath, resolveIndexedBlockContainingPath } from "../../../index/query";
import type { EditorStateAction } from "../../../types";
import { normalizeSelection, target, type EditorSelection } from "../../../selection";
import {
  resolveListItemContextFromSelection,
  resolveRootTextBlockContextFromSelection,
  type ListItemContext,
} from "../../context";
import { spliceInlineNodes } from "../inlines/shared";

// Markdown-shortcut trigger system.
//
// Most insertions splice the typed characters into the current
// selection. A small set of *trigger syntaxes* upgrade an insertion
// into a structural edit instead — typing `# ` at the start of a
// paragraph creates a heading while preserving any suffix content;
// typing `1. ` in a bullet item rewrites the list as ordered; etc.
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
// All patterns are precompiled. Non-whitespace insertions return before index
// lookups, and source inline content is only rebuilt after a pattern matches.

export function resolveInsertionTrigger(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  text: string,
): EditorStateAction | null {
  // The current insertion must supply the whitespace that completes a trigger.
  if (!/\s$/.test(text)) {
    return null;
  }

  // Cross-path selections have no sensible trigger interpretation:
  // the post-replacement text would only contain the inserted
  // characters, dropping anything from the spanned paths.
  if (selection.anchor.path !== selection.focus.path) {
    return null;
  }

  const path = selection.anchor.path;
  const textAtPath = resolveEditorTextAtPath(documentIndex, path);
  const indexedBlock = resolveIndexedBlockContainingPath(documentIndex, path);
  if (textAtPath === null || !indexedBlock) {
    return null;
  }

  // Field-level precheck via the indexed block type: code blocks, table
  // cells, dividers, etc. resolve no context and produce no trigger.
  const context = resolveTriggerContext(documentIndex, selection, indexedBlock.block);
  if (!context) {
    return null;
  }

  const { start, end } = resolveInsertionRange(documentIndex, selection);
  return matchTriggerForContext(textAtPath, text, start, end, context);
}

// ---- Selection range -------------------------------------------------------

// Same-path post-insertion endpoints. Skips the `normalizeSelection`
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

type RootParagraphContext = RootIndexContext & {
  paragraph: ParagraphBlock;
};

type HeadingTriggerContext = RootIndexContext & {
  heading: HeadingBlock;
};

type ListItemTriggerContext = {
  itemContext: ListItemContext;
  paragraph: ParagraphBlock;
};

type TriggerContext =
  | ({ kind: "root-paragraph" } & RootParagraphContext)
  | ({ kind: "heading" } & HeadingTriggerContext)
  | ({ kind: "list-item" } & ListItemTriggerContext);

function resolveTriggerContext(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  block: Block,
): TriggerContext | null {
  // Triggers can only fire inside paragraph and heading paths.
  // Everything else (code, table cells, dividers, …) splices without
  // further work.
  switch (block.type) {
    case "heading": {
      // Confirm the heading is at root level — `resolveRootTextBlockContextFromSelection`
      // returns null for non-root blocks (e.g. nested in containers), and
      // a non-root heading has no sensible depth-change transform.
      const rootBlock = resolveRootTextBlockContextFromSelection(documentIndex, selection);
      return rootBlock?.block.type === "heading"
        ? {
            heading: rootBlock.block,
            kind: "heading",
            rootIndex: rootBlock.rootIndex,
          }
        : null;
    }
    case "paragraph": {
      // Try list-item first: the cursor inside a list item's paragraph
      // wouldn't surface via the root-text-block resolver anyway.
      const listItem = resolveListItemContextFromSelection(documentIndex, selection);
      if (listItem) {
        return listItem.item.children[0] === block
          ? {
              itemContext: listItem,
              kind: "list-item",
              paragraph: block,
            }
          : null;
      }
      const rootBlock = resolveRootTextBlockContextFromSelection(documentIndex, selection);
      return rootBlock?.block.type === "paragraph"
        ? {
            kind: "root-paragraph",
            paragraph: rootBlock.block,
            rootIndex: rootBlock.rootIndex,
          }
        : null;
    }
    default:
      return null;
  }
}

// ---- Trigger dispatch ------------------------------------------------------

function matchTriggerForContext(
  textAtPath: string,
  text: string,
  start: number,
  end: number,
  context: TriggerContext,
): EditorStateAction | null {
  const textThroughInsertion = textAtPath.slice(0, start) + text;

  switch (context.kind) {
    case "root-paragraph":
      return matchAndApply(ROOT_PARAGRAPH_TRIGGERS, textThroughInsertion, () => ({
        paragraph: trimTextBlockPrefix(context.paragraph, end),
        rootIndex: context.rootIndex,
      }));
    case "heading":
      return matchAndApply(HEADING_TRIGGERS, textThroughInsertion, () => ({
        heading: trimTextBlockPrefix(context.heading, end),
        rootIndex: context.rootIndex,
      }));
    case "list-item":
      return matchAndApply(LIST_ITEM_TRIGGERS, textThroughInsertion, () => ({
        itemContext: context.itemContext,
        paragraph: trimTextBlockPrefix(context.paragraph, end),
      }));
  }
}

type Trigger<C> = {
  pattern: RegExp;
  apply: (match: RegExpExecArray, context: C) => EditorStateAction | null;
};

function matchAndApply<C>(
  triggers: readonly Trigger<C>[],
  textThroughInsertion: string,
  resolveContext: () => C,
): EditorStateAction | null {
  for (const { pattern, apply } of triggers) {
    const match = pattern.exec(textThroughInsertion);
    if (match) {
      return apply(match, resolveContext());
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
//
// Every pattern sees only text through the current insertion. Source inline
// content is trimmed only after a pattern matches.
const ROOT_PARAGRAPH_TRIGGERS: readonly Trigger<RootParagraphContext>[] = [
  {
    // Task list: `[ ] ` / `[x] ` / `[]` or `- [ ] ` / `- [x] ` / `- []`
    // (with optional leading indent).
    pattern: compileTriggerPattern(/(?:[-+*]\s+)?\[[ xX]?\]/, {
      allowIndent: true,
    }),
    apply: (match, { paragraph, rootIndex }) =>
      createListAction(rootIndex, paragraph, {
        checked: match[1]!.toLowerCase().includes("x"),
        ordered: false,
        start: null,
      }),
  },
  {
    // Bullet list: `- ` / `+ ` / `* ` (with optional leading indent).
    pattern: compileTriggerPattern(/[-+*]/, { allowIndent: true }),
    apply: (_, { paragraph, rootIndex }) =>
      createListAction(rootIndex, paragraph, {
        checked: null,
        ordered: false,
        start: null,
      }),
  },
  {
    // Ordered list: `1. ` / `42. ` (with optional leading indent).
    pattern: compileTriggerPattern(/\d+\./, { allowIndent: true }),
    apply: (match, { paragraph, rootIndex }) =>
      createListAction(rootIndex, paragraph, {
        checked: null,
        ordered: true,
        start: Number(match[1]!.slice(0, -1)),
      }),
  },
  {
    // Heading: `# ` through `###### `.
    pattern: compileTriggerPattern(/#{1,6}/, { allowIndent: false }),
    apply: (match, { paragraph, rootIndex }) =>
      createHeadingAction(
        rootIndex,
        createHeadingBlock({
          children: paragraph.children,
          depth: match[1]!.length as HeadingBlock["depth"],
        }),
      ),
  },
  {
    // Blockquote: `> `.
    pattern: compileTriggerPattern(/>/, { allowIndent: false }),
    apply: (_, { paragraph, rootIndex }) => createBlockquoteAction(rootIndex, paragraph),
  },
  {
    // Thematic break: `--- `.
    pattern: compileTriggerPattern(/---/, { allowIndent: false }),
    apply: (_, { paragraph, rootIndex }) => createDividerAction(rootIndex, paragraph),
  },
];

const HEADING_TRIGGERS: readonly Trigger<HeadingTriggerContext>[] = [
  {
    // Change heading depth by typing `#`s in front of existing heading text.
    pattern: compileTriggerPattern(/#{1,6}/, { allowIndent: true }),
    apply: (match, { heading, rootIndex }) =>
      createHeadingAction(
        rootIndex,
        createHeadingBlock({
          children: heading.children,
          depth: match[1]!.length as HeadingBlock["depth"],
        }),
      ),
  },
];

// Patterns anchor on distinct leading characters (`[-+*]`, digit, `[`),
// so they're mutually exclusive and the order within this list is just
// for readability. See the task-list note in `ROOT_PARAGRAPH_TRIGGERS`
// for why task triggers off `[` rather than `[-+*]`.
const LIST_ITEM_TRIGGERS: readonly Trigger<ListItemTriggerContext>[] = [
  {
    // Convert to ordered list, preserving existing checked state.
    pattern: compileTriggerPattern(/\d+\./, { allowIndent: true }),
    apply: (match, ctx) =>
      transformListAction(ctx, {
        ordered: true,
        start: 1,
        checked: ctx.itemContext.item.checked,
      }),
  },
  {
    // Convert to task list, reading the checkbox state from the typed marker.
    pattern: compileTriggerPattern(/\[[ xX]?\]/, { allowIndent: true }),
    apply: (match, ctx) =>
      transformListAction(ctx, {
        ordered: false,
        start: null,
        checked: match[1]!.toLowerCase().includes("x"),
      }),
  },
  {
    // Convert to bullet list, clearing checked state.
    pattern: compileTriggerPattern(/[-+*]/, { allowIndent: true }),
    apply: (_, ctx) => transformListAction(ctx, { ordered: false, start: null, checked: null }),
  },
];

// ---- Pattern compilation (computed once, at module load) -------------------

function compileTriggerPattern(body: RegExp, options: { allowIndent: boolean }): RegExp {
  const leading = options.allowIndent ? "\\s*" : "";
  return new RegExp(`^${leading}(${body.source})\\s$`);
}

// ---- Trigger action factories ----------------------------------------------

function trimTextBlockPrefix(block: ParagraphBlock, suffixStart: number): ParagraphBlock;
function trimTextBlockPrefix(block: HeadingBlock, suffixStart: number): HeadingBlock;
function trimTextBlockPrefix(
  block: HeadingBlock | ParagraphBlock,
  suffixStart: number,
): HeadingBlock | ParagraphBlock {
  return suffixStart === 0
    ? block
    : rebuildTextBlock(block, spliceInlineNodes(block.children, 0, suffixStart, []));
}

function createHeadingAction(rootIndex: number, heading: HeadingBlock): EditorStateAction {
  return replaceRootWithBlocks(rootIndex, [heading], heading);
}

function createBlockquoteAction(rootIndex: number, paragraph: ParagraphBlock): EditorStateAction {
  return replaceRootWithBlocks(rootIndex, [createBlockquoteBlock([paragraph])], paragraph);
}

function createDividerAction(rootIndex: number, paragraph: ParagraphBlock): EditorStateAction {
  return replaceRootWithBlocks(rootIndex, [createDividerBlock(), paragraph], paragraph);
}

function createListAction(
  rootIndex: number,
  paragraph: ParagraphBlock,
  options: { checked: boolean | null; ordered: boolean; start: number | null },
): EditorStateAction {
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

function transformListAction(
  context: ListItemTriggerContext,
  options: { ordered: boolean; start: number | null; checked: boolean | null },
): EditorStateAction {
  const itemContext = context.itemContext;
  const updatedItem = rebuildListItemBlock(itemContext.item, [
    context.paragraph,
    ...itemContext.item.children.slice(1),
  ]);
  const transformedItem = { ...updatedItem, checked: options.checked };

  return {
    kind: "replace-block",
    block: rebuildListBlock(
      itemContext.list,
      itemContext.list.items.map((item, index) =>
        index === itemContext.itemIndex ? transformedItem : item,
      ),
      { ordered: options.ordered, start: options.start },
    ),
    blockPath: itemContext.listPath,
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
