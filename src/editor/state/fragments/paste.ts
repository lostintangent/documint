// Paste insertion policy. This file turns a clipboard `Fragment` plus the
// current editor state into the lowest-altitude editor action that can apply
// it, including paste-specific fallback and semantic effects.

import {
  createParagraphBlock,
  extractPlainTextFromFragment,
  extractPlainTextFromInlineNodes,
  rootBlockPath,
  type Fragment,
} from "@/document";
import { resolveInlineContext, type InlineContext } from "../commands/context";
import { effect } from "../effects";
import type { DocumentIndex, IndexedBlock } from "../index/types";
import {
  resolveBlockTextPathBoundary,
  resolveIndexedBlockContainingPath,
  resolveIndexedText,
} from "../index/query";
import {
  normalizeSelection,
  type EditorSelection,
  type NormalizedEditorSelection,
} from "../selection";
import type { EditorState, EditorStateAction } from "../types";
import { insertInlines } from "../commands/actions/inlines";

type FragmentDestinationContext = {
  prefersVerbatimFallback: boolean;
  samePath: boolean;
  structuralBlocked: boolean;
};

type DestinationEndpoint = {
  indexedBlock: IndexedBlock;
  path: string;
  text: string;
};

type PasteFragmentContext = {
  destination: FragmentDestinationContext;
  documentIndex: DocumentIndex;
  inlineContext: InlineContext | null;
  selection: EditorSelection;
};

// --- Paste context ----------------------------------------------------------

export function resolvePasteFragmentContext(
  state: EditorState,
  _fragment: Fragment,
  _verbatimFallback?: string,
): PasteFragmentContext | null {
  const destination = resolveFragmentDestinationContext(state.documentIndex, state.selection);

  if (!destination) {
    return null;
  }

  return {
    destination,
    documentIndex: state.documentIndex,
    inlineContext: destination.samePath ? resolveInlineContext(state) : null,
    selection: state.selection,
  };
}

// --- Paste action policy ----------------------------------------------------

export function resolvePasteFragmentAction(
  context: PasteFragmentContext,
  fragment: Fragment,
  verbatimFallback?: string,
): EditorStateAction | null {
  const action =
    resolveFragmentApplication(context, fragment) ??
    resolveOpaqueFragmentFallback(context, fragment, verbatimFallback);

  return action ? withPastedInlineTextHighlight(context, action, fragment) : null;
}

function resolveFragmentApplication(
  context: PasteFragmentContext,
  fragment: Fragment,
): EditorStateAction | null {
  switch (fragment.kind) {
    case "text":
      return fragment.text.length > 0
        ? {
            kind: "splice-text",
            text: fragment.text,
          }
        : null;

    case "inlines": {
      if (fragment.inlines.length === 0) {
        return null;
      }

      // Single-path inline paste: splice the inlines directly into the
      // destination leaf, so the surrounding container stays intact.
      if (context.destination.samePath) {
        const action = context.inlineContext
          ? insertInlines(context.inlineContext, fragment.inlines)
          : null;
        if (action) {
          return action;
        }
      }

      // Cross-path or unsupported destination: synthesize a paragraph and
      // use the structural path. Opaque roots reject the same way `blocks`
      // does.
      if (context.destination.structuralBlocked) {
        return null;
      }

      return {
        kind: "splice-fragment",
        blocks: [createParagraphBlock(fragment.inlines)],
      };
    }

    case "blocks":
      if (fragment.blocks.length === 0 || context.destination.structuralBlocked) {
        return null;
      }

      return {
        kind: "splice-fragment",
        blocks: fragment.blocks,
      };
  }
}

function resolveOpaqueFragmentFallback(
  context: PasteFragmentContext,
  fragment: Fragment,
  verbatimFallback: string | undefined,
): EditorStateAction | null {
  if (fragment.kind === "text") {
    return null;
  }

  // Code blocks store source text, so preserve every character of the
  // original clipboard payload. Table cells, or code blocks without a
  // verbatim source, take the fragment's plain-text projection.
  const fallbackText =
    context.destination.prefersVerbatimFallback && verbatimFallback && verbatimFallback.length > 0
      ? verbatimFallback
      : extractPlainTextFromFragment(fragment);

  return fallbackText.length > 0 ? { kind: "splice-text", text: fallbackText } : null;
}

// --- Paste effects ----------------------------------------------------------

// The text that paste landed inline in the destination path. For `text` and
// `inlines`, that's the whole payload. For a single-paragraph block fragment,
// it's the paragraph's text because the seam merge absorbs it into the
// destination block's inline content. Multi-block fragments report empty text.
function resolvePastedInlineText(action: EditorStateAction, fragment: Fragment): string {
  if (action.kind === "splice-text") {
    return action.text;
  }

  if (action.kind === "replace-block" || action.kind === "splice-fragment") {
    return inlineInsertionText(fragment);
  }

  return "";
}

function inlineInsertionText(fragment: Fragment): string {
  switch (fragment.kind) {
    case "text":
      return fragment.text;
    case "inlines":
      return extractPlainTextFromInlineNodes(fragment.inlines);
    case "blocks":
      return fragment.blocks.length === 1 && fragment.blocks[0]!.type === "paragraph"
        ? fragment.blocks[0]!.plainText
        : "";
  }
}

function withPastedInlineTextHighlight(
  context: PasteFragmentContext,
  action: EditorStateAction,
  fragment: Fragment,
): EditorStateAction {
  const insertedEffect = effect.textInsertedAtSelection(
    context.documentIndex,
    context.selection,
    resolvePastedInlineText(action, fragment),
  );

  return insertedEffect ? { ...action, effect: insertedEffect } : action;
}

// --- Destination classification --------------------------------------------

function resolveFragmentDestinationContext(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): FragmentDestinationContext | null {
  const normalized = normalizeSelection(documentIndex, selection);
  const startEndpoint = resolveDestinationEndpoint(documentIndex, normalized.start.path);
  const endEndpoint = resolveDestinationEndpoint(documentIndex, normalized.end.path);

  if (!startEndpoint || !endEndpoint) {
    return null;
  }

  const structuralBlocked =
    cutsThroughOpaqueRoot(
      documentIndex,
      startEndpoint,
      normalized.start.offset,
      "start",
      normalized,
    ) ||
    cutsThroughOpaqueRoot(
      documentIndex,
      endEndpoint,
      normalized.end.offset,
      "end",
      normalized,
    );

  return {
    prefersVerbatimFallback:
      startEndpoint.indexedBlock.block.type === "code" ||
      endEndpoint.indexedBlock.block.type === "code",
    samePath: startEndpoint.path === endEndpoint.path,
    structuralBlocked,
  };
}

function resolveDestinationEndpoint(
  documentIndex: DocumentIndex,
  path: string,
): DestinationEndpoint | null {
  const indexedBlock = resolveIndexedBlockContainingPath(documentIndex, path);
  const indexedText = resolveIndexedText(documentIndex, path);

  return indexedBlock && indexedText ? { indexedBlock, path, text: indexedText.text } : null;
}

function isOpaqueEndpoint(endpoint: DestinationEndpoint): boolean {
  return (
    endpoint.indexedBlock.block.type === "table" ||
    endpoint.indexedBlock.block.type === "code"
  );
}

function cutsThroughOpaqueRoot(
  documentIndex: DocumentIndex,
  endpoint: DestinationEndpoint,
  offset: number,
  boundary: "end" | "start",
  selection: NormalizedEditorSelection,
): boolean {
  if (!isOpaqueEndpoint(endpoint)) {
    return false;
  }

  if (selection.collapsed) {
    return true;
  }

  return !isRootBoundary(documentIndex, endpoint, offset, boundary);
}

function isRootBoundary(
  documentIndex: DocumentIndex,
  endpoint: DestinationEndpoint,
  offset: number,
  boundary: "end" | "start",
): boolean {
  const rootBoundaryPath = resolveBlockTextPathBoundary(
    documentIndex,
    rootBlockPath(endpoint.indexedBlock.rootIndex),
    boundary,
  );
  const boundaryText = rootBoundaryPath
    ? resolveIndexedText(documentIndex, rootBoundaryPath)?.text
    : null;
  const endpointOffset = boundary === "start" ? 0 : boundaryText?.length;

  return rootBoundaryPath === endpoint.path && offset === endpointOffset;
}
