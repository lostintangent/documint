import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { visitBlockTree, type Block } from "@/document";
import type { TextDecorationIndex } from "@/editor";
import type { CodeGrammarRule, DocumintDecoration, ResolvedEditorTheme } from "@/types";
import {
  remapDecorationIndexForTextEdit,
  reconcileDecorationRootResults,
  resolveDecorationRootSnapshots,
} from "./client/reconciliation";
import {
  isValidDecoration,
  resolveDecorationsKey,
} from "./client/config";
import { resolveCodeGrammars } from "./grammars";
import type { DocumintStore, EditorStateTransition } from "../store";
import {
  createDecorationWorkerClient,
  isDecorationWorkerDisposedError,
  type DecorationResult,
  type DecorationWorkerClient,
} from "./client/worker";

const DECORATION_TRANSITION_DEBOUNCE_MS = 220;

export type { DocumintDecoration } from "@/types";

type UseDecorationsOptions = {
  decorations?: readonly DocumintDecoration[];
  grammars?: Record<string, readonly CodeGrammarRule[]> | null;
  store: DocumintStore;
  theme: ResolvedEditorTheme;
};

export function useDecorations({
  decorations,
  grammars,
  store,
  theme,
}: UseDecorationsOptions) {
  /* Resolve inputs */

  const decorationRules = useMemo(() => {
    return decorations?.filter(isValidDecoration) ?? [];
  }, [decorations]);

  // Syntax highlighting is a code-specific decoration: each grammar's scope
  // rules resolve to concrete colors against the theme here, so the worker only
  // ever matches colors. Keyed by language for per-code-block lookup.
  const codeGrammars = useMemo(() => {
    if (!grammars) return null;
    const resolved = resolveCodeGrammars(
      grammars,
      (token) => theme.codeTokens[token] ?? theme.codeText,
    );
    return Object.keys(resolved).length === 0 ? null : resolved;
  }, [grammars, theme.codeTokens, theme.codeText]);

  const decorationsConfigured = decorationRules.length > 0 || codeGrammars !== null;
  const decorationConfigKey = useMemo(
    () => resolveDecorationConfigKey(decorationRules, codeGrammars),
    [decorationRules, codeGrammars],
  );

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

  const applyDecorationResult = useEffectEvent((result: DecorationResult) => {
    if (result.configKey !== decorationConfigKey || result.roots.length === 0) {
      return;
    }

    setTextDecorations((current) => {
      return (
        reconcileDecorationRootResults(store.editor.getState(), current, result.roots) ?? current
      );
    });
  });

  /* Decoration jobs */

  const runDecorations = useEffectEvent(
    (roots: ReturnType<typeof resolveDecorationRootSnapshots>) => {
      const client = decorationWorkerRef.current ?? createDecorationWorkerClient();

      decorationWorkerRef.current = client;

      void client
        .run({
          codeGrammars: codeGrammars ?? {},
          configKey: decorationConfigKey,
          decorations: decorationRules,
          roots,
        })
        .then(applyDecorationResult)
        .catch((error: unknown) => {
          if (isDecorationWorkerDisposedError(error)) {
            return;
          }

          // Drop the dead client so the next job creates a fresh worker.
          if (decorationWorkerRef.current === client) {
            decorationWorkerRef.current = null;
          }
          clearTextDecorations();
        });
    },
  );

  const updateDecorations = useEffectEvent((rootIndexes?: readonly number[]) => {
    const currentState = store.editor.getState();
    const roots = resolveDecorationRootSnapshots(
      currentState.documentIndex.document,
      rootIndexes,
    );

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
    pendingDecorationRootIndexesRef.current = null;
    pendingDecorationTimerRef.current = null;

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

    const edit =
      effect.kind === "text-inserted"
        ? {
            deletedLength: 0,
            insertedLength: effect.text.length,
            regionPath: effect.regionPath,
            startOffset: effect.startOffset,
          }
        : {
            deletedLength: effect.text.length,
            insertedLength: 0,
            regionPath: effect.regionPath,
            startOffset: effect.startOffset,
          };

    setTextDecorations((current) => remapDecorationIndexForTextEdit(current, edit) ?? current);
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

    if (isSourceTextEditTransition(transition)) {
      clearPendingDecorationRequest();
      updateDecorations(transition.changedRootIndexes);
    } else {
      scheduleRootDecorationUpdate(transition.changedRootIndexes);
    }
  });

  /* Worker lifecycle */

  useEffect(() => {
    return () => {
      clearPendingDecorationRequest();
      decorationWorkerRef.current?.dispose();
      decorationWorkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (decorationsConfigured) {
      return;
    }

    clearPendingDecorationRequest();
    decorationWorkerRef.current?.dispose();
    decorationWorkerRef.current = null;
    clearTextDecorations();
  }, [decorationsConfigured]);

  useEffect(() => {
    return store.editor.subscribe(handleEditorTransition);
  }, [store]);

  /* Generation refresh */

  useEffect(() => {
    if (!decorationsConfigured) {
      return;
    }

    refreshDecorations();
  }, [decorationConfigKey, decorationsConfigured]);

  /* Transition policy */

  function shouldRefreshDecorations(state: ReturnType<DocumintStore["editor"]["getState"]>) {
    if (!decorationsConfigured) {
      return false;
    }

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
      effect.regionKind === "source",
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
