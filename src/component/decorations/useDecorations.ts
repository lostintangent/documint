import { useEffect, useEffectEvent, useRef, useState } from "react";
import { visitBlockTree, type Block } from "@/document";
import { remapTextDecorationIndex, type TextDecorationIndex } from "@/editor";
import type { ResolvedEditorTheme } from "@/renderer";
import {
  reconcileDecorationRootResults,
  resolveDecorationRootSnapshots,
} from "./client/reconciliation";
import { resolveDecorationsKey } from "./client/config";
import { createDecorationWorkerClient, type DecorationWorkerClient } from "./client/worker";
import { resolveCodeGrammars, type CodeGrammarRule } from "./grammars";
import { isValidDecoration, type DecorationRootResult, type DocumintDecoration } from "./shared";
import type { DocumintStore, EditorStateTransition } from "../store";

const DECORATION_TRANSITION_DEBOUNCE_MS = 220;

type UseDecorationsOptions = {
  decorations?: readonly DocumintDecoration[];
  grammars?: Record<string, readonly CodeGrammarRule[]> | null;
  store: DocumintStore;
  theme: ResolvedEditorTheme;
};

export function useDecorations({ decorations, grammars, store, theme }: UseDecorationsOptions) {
  /* Resolve inputs */

  const decorationRules = decorations?.filter(isValidDecoration) ?? [];

  // Syntax highlighting is a code-specific decoration: each grammar's scope
  // rules resolve to concrete colors against the theme here, so the worker only
  // ever matches colors. Keyed by language for per-code-block lookup.
  const resolvedCodeGrammars = grammars
    ? resolveCodeGrammars(grammars, (token) => theme.codeTokens[token] ?? theme.codeText)
    : {};
  const codeGrammars = Object.keys(resolvedCodeGrammars).length === 0 ? null : resolvedCodeGrammars;

  const decorationsConfigured = decorationRules.length > 0 || codeGrammars !== null;
  const decorationConfigKey = resolveDecorationConfigKey(decorationRules, codeGrammars);

  /* Decoration state */

  const decorationWorkerRef = useRef<DecorationWorkerClient | null>(null);
  const pendingDecorationRootIndexesRef = useRef<Set<number> | null>(null);
  const pendingDecorationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [textDecorations, setTextDecorations] = useState<TextDecorationIndex>(() => new Map());

  /* Small state mutators */

  const clearPendingDecorationRequest = () => {
    if (pendingDecorationTimerRef.current !== null) {
      clearTimeout(pendingDecorationTimerRef.current);
      pendingDecorationTimerRef.current = null;
    }
    pendingDecorationRootIndexesRef.current = null;
  };

  const clearTextDecorations = () => {
    setTextDecorations((current) => (current.size === 0 ? current : new Map()));
  };

  const applyDecorationResult = useEffectEvent(
    (configKey: string, results: readonly DecorationRootResult[]) => {
      if (configKey !== decorationConfigKey || results.length === 0) {
        return;
      }

      setTextDecorations((current) => {
        return reconcileDecorationRootResults(store.editor.getState(), current, results) ?? current;
      });
    },
  );

  /* Transition policy */

  function shouldRefreshDecorations(state: ReturnType<DocumintStore["editor"]["getState"]>) {
    if (decorationRules.length > 0) {
      return true;
    }

    if (codeGrammars === null) {
      return false;
    }

    return documentContainsCode(state.documentIndex.document.blocks);
  }

  function affectsConfiguredDecorations(transition: EditorStateTransition) {
    if (decorationRules.length > 0) {
      return true;
    }

    if (codeGrammars === null) {
      return false;
    }

    if (didRootCountChange(transition)) {
      return (
        documentContainsCode(transition.previous.documentIndex.document.blocks) ||
        documentContainsCode(transition.next.documentIndex.document.blocks)
      );
    }

    return transition.changedRootIndexes.some((rootIndex) =>
      documentContainsCode([
        transition.previous.documentIndex.document.blocks[rootIndex],
        transition.next.documentIndex.document.blocks[rootIndex],
      ]),
    );
  }

  /* Decoration jobs */

  const runDecorations = useEffectEvent(
    (roots: ReturnType<typeof resolveDecorationRootSnapshots>) => {
      const client = decorationWorkerRef.current ?? createDecorationWorkerClient();
      const configKey = decorationConfigKey;

      decorationWorkerRef.current = client;

      void client
        .run({ codeGrammars: codeGrammars ?? {}, configKey, decorations: decorationRules, roots })
        .then((results) => applyDecorationResult(configKey, results))
        .catch(() => {
          // A disposed client was already detached, so its rejection is not a
          // failure. Otherwise drop the dead client so the next job creates a
          // fresh worker.
          if (decorationWorkerRef.current !== client) {
            return;
          }

          decorationWorkerRef.current = null;
          clearTextDecorations();
        });
    },
  );

  const updateDecorations = useEffectEvent((rootIndexes?: readonly number[]) => {
    const currentState = store.editor.getState();
    const roots = resolveDecorationRootSnapshots(currentState.documentIndex.document, rootIndexes);

    if (roots.length === 0) {
      return false;
    }

    runDecorations(roots);
    return true;
  });

  const refreshDecorations = useEffectEvent(() => {
    clearPendingDecorationRequest();

    const currentState = store.editor.getState();
    if (!shouldRefreshDecorations(currentState)) {
      clearTextDecorations();
      return;
    }

    if (!updateDecorations()) {
      clearTextDecorations();
    }
  });

  /* Transition batching */

  const flushPendingDecorations = useEffectEvent(() => {
    const pendingRootIndexes = pendingDecorationRootIndexesRef.current;
    clearPendingDecorationRequest();

    if (!pendingRootIndexes || pendingRootIndexes.size === 0) {
      return;
    }

    updateDecorations([...pendingRootIndexes]);
  });

  const scheduleRootDecorationUpdate = useEffectEvent((rootIndexes: readonly number[]) => {
    const pendingRootIndexes = pendingDecorationRootIndexesRef.current ?? new Set<number>();
    pendingDecorationRootIndexesRef.current = pendingRootIndexes;

    for (const rootIndex of rootIndexes) {
      pendingRootIndexes.add(rootIndex);
    }

    if (pendingDecorationTimerRef.current !== null) {
      clearTimeout(pendingDecorationTimerRef.current);
    }

    pendingDecorationTimerRef.current = setTimeout(
      flushPendingDecorations,
      DECORATION_TRANSITION_DEBOUNCE_MS,
    );
  });

  const applyProvisionalTextEdit = useEffectEvent((transition: EditorStateTransition) => {
    if (transition.changedRootIndexes.length !== 1) {
      return;
    }

    const textEditEffects = transition.effects.filter(
      (effect) => effect.kind === "text-inserted" || effect.kind === "text-deleted",
    );
    if (textEditEffects.length !== 1) {
      return;
    }

    const [effect] = textEditEffects;
    if (!effect) {
      return;
    }

    setTextDecorations((current) => remapTextDecorationIndex(current, effect) ?? current);
  });

  const handleEditorTransition = useEffectEvent((transition: EditorStateTransition) => {
    if (!decorationsConfigured || !transition.documentChanged) {
      return;
    }

    if (transition.source === "external") {
      refreshDecorations();
      return;
    }

    if (!affectsConfiguredDecorations(transition)) {
      return;
    }

    if (didRootCountChange(transition)) {
      refreshDecorations();
      return;
    }

    applyProvisionalTextEdit(transition);
    scheduleRootDecorationUpdate(transition.changedRootIndexes);

    // Source edits classify right away, along with any roots already batched.
    if (isSourceTextEditTransition(transition)) {
      flushPendingDecorations();
    }
  });

  /* Worker lifecycle */

  // The worker lives while any decorations are configured. Unconfiguring or
  // unmounting tears it down along with pending work and painted ranges.
  useEffect(() => {
    if (!decorationsConfigured) {
      return;
    }

    return () => {
      clearPendingDecorationRequest();
      decorationWorkerRef.current?.dispose();
      decorationWorkerRef.current = null;
      clearTextDecorations();
    };
  }, [decorationsConfigured]);

  useEffect(() => {
    return store.editor.subscribe(handleEditorTransition);
  }, [store]);

  /* Generation refresh */

  useEffect(() => {
    if (!decorationsConfigured) {
      return;
    }

    // Synchronizes painted ranges with the worker-owned configuration. The
    // clear inside is idempotent, so it cannot cascade.
    // oxlint-disable-next-line react/set-state-in-effect
    refreshDecorations();
  }, [decorationConfigKey, decorationsConfigured]);

  /* Public API */

  return { textDecorations };
}

function didRootCountChange(transition: EditorStateTransition) {
  return (
    transition.previous.documentIndex.document.blocks.length !==
    transition.next.documentIndex.document.blocks.length
  );
}

function isSourceTextEditTransition(transition: EditorStateTransition) {
  return transition.effects.some(
    (effect) =>
      (effect.kind === "text-inserted" || effect.kind === "text-deleted") &&
      effect.contentKind === "source",
  );
}

function documentContainsCode(blocks: readonly (Block | undefined)[]): boolean {
  return blocks.some((root) => {
    if (!root) {
      return false;
    }

    let found = false;
    visitBlockTree([root], {
      enterBlock(block) {
        if (block.type === "code") {
          found = true;
          return "stop";
        }
      },
    });
    return found;
  });
}

// Combined staleness key: prose rules plus per-language code rules (which carry
// resolved colors, so a theme switch invalidates and re-tokenizes). The worker
// configures both buckets atomically under this single key.
function resolveDecorationConfigKey(
  rules: readonly DocumintDecoration[],
  codeGrammars: Record<string, readonly DocumintDecoration[]> | null,
): string {
  const proseKey = resolveDecorationsKey(rules);
  const resolvedCodeGrammars = codeGrammars ?? {};
  const codeKey = Object.keys(resolvedCodeGrammars)
    .sort()
    .map((language) => `${language}:${resolveDecorationsKey(resolvedCodeGrammars[language]!)}`)
    .join("|");
  return `${proseKey}::${codeKey}`;
}
