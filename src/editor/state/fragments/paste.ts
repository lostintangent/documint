// Paste insertion policy. This file turns a clipboard `Fragment` plus the
// current editor state into the lowest-altitude editor action that can apply
// it, including paste-specific fallback and semantic effects.

import {
  createParagraphBlock,
  extractPlainTextFromFragment,
  rootBlockPath,
  type Fragment,
} from "@/document";
import { resolveInlineContext, type InlineContext } from "../commands/context";
import { effect } from "../effects";
import { resolveFragmentRange, type FragmentEndpoint } from "./context";
import type { DocumentIndex } from "../index/types";
import { resolveBlockTextPathBoundary, resolveIndexedText } from "../index/query";
import type { EditorSelection } from "../selection";
import type { EditorState, EditorStateAction } from "../types";
import { insertInlines } from "../commands/actions/inlines";
import { editorInlinesText } from "../../text/inline-offsets";

type PasteFragmentContext = {
  documentIndex: DocumentIndex;
  inlineContext: InlineContext | null;
  prefersVerbatimFallback: boolean;
  selection: EditorSelection;
  structuralBlocked: boolean;
};

// --- Paste context ----------------------------------------------------------

export function resolvePasteFragmentContext(state: EditorState): PasteFragmentContext | null {
  const { documentIndex, selection } = state;
  const range = resolveFragmentRange(documentIndex, selection);

  if (!range) {
    return null;
  }

  const { collapsed, end, start } = range;

  return {
    documentIndex,
    inlineContext: resolveInlineContext(state),
    prefersVerbatimFallback:
      start.indexedBlock.block.type === "code" || end.indexedBlock.block.type === "code",
    selection,
    structuralBlocked:
      cutsThroughOpaqueRoot(documentIndex, start, "start", collapsed) ||
      cutsThroughOpaqueRoot(documentIndex, end, "end", collapsed),
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
      const action =
        context.inlineContext && insertInlines(context.inlineContext, fragment.inlines);
      if (action) {
        return action;
      }

      // Cross-path or unsupported destination: synthesize a paragraph and
      // use the structural path. Opaque roots reject the same way `blocks`
      // does.
      if (context.structuralBlocked) {
        return null;
      }

      return {
        kind: "splice-fragment",
        blocks: [createParagraphBlock(fragment.inlines)],
      };
    }

    case "blocks":
      if (fragment.blocks.length === 0 || context.structuralBlocked) {
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
    context.prefersVerbatimFallback && verbatimFallback && verbatimFallback.length > 0
      ? verbatimFallback
      : extractPlainTextFromFragment(fragment);

  return fallbackText.length > 0 ? { kind: "splice-text", text: fallbackText } : null;
}

// --- Paste effects ----------------------------------------------------------

// The editor text that paste landed inline in the destination path, with each
// reference as one unit so the highlight spans exactly the pasted content. For
// `text` and `inlines`, that's the whole payload. For a single-paragraph block
// fragment, it's the paragraph's text because the seam merge absorbs it into
// the destination block's inline content. Multi-block fragments report empty
// text.
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
      return editorInlinesText(fragment.inlines);
    case "blocks":
      return fragment.blocks.length === 1 && fragment.blocks[0]!.type === "paragraph"
        ? editorInlinesText(fragment.blocks[0]!.children)
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

function isOpaqueEndpoint(endpoint: FragmentEndpoint): boolean {
  return (
    endpoint.indexedBlock.block.type === "table" || endpoint.indexedBlock.block.type === "code"
  );
}

function cutsThroughOpaqueRoot(
  documentIndex: DocumentIndex,
  endpoint: FragmentEndpoint,
  boundary: "end" | "start",
  collapsed: boolean,
): boolean {
  if (!isOpaqueEndpoint(endpoint)) {
    return false;
  }

  if (collapsed) {
    return true;
  }

  return !isRootBoundary(documentIndex, endpoint, boundary);
}

function isRootBoundary(
  documentIndex: DocumentIndex,
  endpoint: FragmentEndpoint,
  boundary: "end" | "start",
): boolean {
  const rootBoundaryPath = resolveBlockTextPathBoundary(
    documentIndex,
    rootBlockPath(endpoint.indexedBlock.rootIndex),
    boundary,
  );
  const boundaryText = rootBoundaryPath
    ? resolveIndexedText(documentIndex, rootBoundaryPath)
    : null;
  const endpointOffset = boundary === "start" ? 0 : boundaryText?.text.length;

  return rootBoundaryPath === endpoint.path && endpoint.offset === endpointOffset;
}
