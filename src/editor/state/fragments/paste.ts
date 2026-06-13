// Paste insertion policy. This file turns a clipboard `Fragment` plus the
// current editor state into the lowest-altitude editor action that can apply
// it, including paste-specific fallback and semantic effects.

import {
  createParagraphBlock,
  extractPlainTextFromFragment,
  extractPlainTextFromInlineNodes,
  type Fragment,
} from "@/document";
import { resolveInlineContext, type InlineContext } from "../commands/context";
import { effect } from "../effects";
import type { DocumentIndex, EditableRegion } from "../index/types";
import { normalizeSelection, resolveRegion, type EditorSelection } from "../selection";
import type { EditorState, EditorStateAction } from "../types";
import { insertInlines } from "../commands/actions/inlines";

type FragmentDestinationContext = {
  prefersVerbatimFallback: boolean;
  sameRegion: boolean;
  structuralBlocked: boolean;
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
    inlineContext: destination.sameRegion ? resolveInlineContext(state) : null,
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

      // Single-region inline paste: splice the inlines directly into the
      // destination leaf, so the surrounding container stays intact.
      if (context.destination.sameRegion) {
        const action = context.inlineContext
          ? insertInlines(context.inlineContext, fragment.inlines)
          : null;
        if (action) {
          return action;
        }
      }

      // Cross-region or unsupported destination: synthesize a paragraph and
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

// The text that paste landed inline in the destination region. For `text` and
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
  const startRegion = resolveRegion(documentIndex, normalized.start.regionId);
  const endRegion = resolveRegion(documentIndex, normalized.end.regionId);

  if (!startRegion || !endRegion) {
    return null;
  }

  const structuralBlocked = isOpaqueRegion(startRegion) || isOpaqueRegion(endRegion);

  return {
    prefersVerbatimFallback: startRegion.block.type === "code" || endRegion.block.type === "code",
    sameRegion: startRegion === endRegion,
    structuralBlocked,
  };
}

function isOpaqueRegion(region: EditableRegion): boolean {
  return region.block.type === "table" || region.block.type === "code";
}
