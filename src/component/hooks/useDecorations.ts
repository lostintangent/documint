import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { Document } from "@/document";
import type { TextDecorationIndex } from "@/editor";
import { emitDiagnostic } from "../lib/diagnostics";
import {
  reconcileDecorationRootResults,
  resolveDecorationRootSnapshots,
} from "../decorations/reconciliation";
import {
  hasDecorationRuleStyle,
  resolveDecorationRulesKey,
  type DocumintDecoration,
} from "../decorations/rules";
import type { DocumintStore, EditorStateTransition } from "../store";
import {
  createDecorationWorkerClient,
  isDecorationWorkerDisposedError,
  type DecorationJobResult,
  type DecorationWorkerClient,
} from "../worker/client";

const DECORATION_TRANSITION_DEBOUNCE_MS = 220;
const emptyDecorationRules: readonly DocumintDecoration[] = [];
const emptyTextDecorations: TextDecorationIndex = new Map();

export type { DocumintDecoration } from "../decorations/rules";

type UseDecorationsOptions = {
  contentDocument: Document;
  decorations?: readonly DocumintDecoration[];
  store: DocumintStore;
};

export function useDecorations({ contentDocument, decorations, store }: UseDecorationsOptions) {
  /* Decoration rules */

  const decorationRules = useMemo(() => {
    const effectiveRules = decorations?.filter(hasDecorationRuleStyle) ?? emptyDecorationRules;
    return effectiveRules.length === 0 ? emptyDecorationRules : effectiveRules;
  }, [decorations]);
  const decorationsEnabled = decorationRules.length > 0;
  const decorationRulesKey = useMemo(
    () => resolveDecorationRulesKey(decorationRules),
    [decorationRules],
  );

  /* Decoration state */

  const decorationWorkerRef = useRef<DecorationWorkerClient | null>(null);
  const pendingDecorationRootIndexesRef = useRef<Set<number> | null>(null);
  const pendingDecorationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [textDecorations, setTextDecorations] = useState<TextDecorationIndex>(
    () => emptyTextDecorations,
  );

  const clearPendingDecorationRequest = () => {
    if (pendingDecorationTimerRef.current !== null) {
      clearTimeout(pendingDecorationTimerRef.current);
      pendingDecorationTimerRef.current = null;
    }
    pendingDecorationRootIndexesRef.current = null;
  };

  const clearTextDecorations = () => {
    setTextDecorations((current) => (current.size === 0 ? current : emptyTextDecorations));
  };

  /* Decoration results */

  const applyDecorationResult = useEffectEvent((result: DecorationJobResult) => {
    if (result.rulesKey !== decorationRulesKey || result.roots.length === 0) {
      return;
    }

    setTextDecorations((current) => {
      return (
        reconcileDecorationRootResults(store.editor.getState(), current, result.roots) ?? current
      );
    });
  });

  /* Decoration jobs */

  const scheduleDecorations = useEffectEvent(
    (rootIndexes?: readonly number[], refreshGeneration = false) => {
      if (refreshGeneration) {
        clearPendingDecorationRequest();
      }

      if (!decorationsEnabled) {
        clearTextDecorations();
        return;
      }

      const currentState = store.editor.getState();
      const roots = resolveDecorationRootSnapshots(
        currentState.documentIndex.document,
        rootIndexes,
      );

      if (roots.length === 0) {
        clearTextDecorations();
        return;
      }

      const client = decorationWorkerRef.current ?? createDecorationWorkerClient();

      if (!client) {
        clearTextDecorations();
        return;
      }

      decorationWorkerRef.current = client;

      void client
        .run({
          roots,
          rules: decorationRules,
          rulesKey: decorationRulesKey,
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

          if (process.env.NODE_ENV !== "production") {
            emitDiagnostic("decorationError", {
              message: error instanceof Error ? error.message : String(error),
            });
          }
        });
    },
  );

  /* Transition batching */

  const flushPendingDecorations = useEffectEvent(() => {
    const pendingRootIndexes = pendingDecorationRootIndexesRef.current;
    pendingDecorationRootIndexesRef.current = null;
    pendingDecorationTimerRef.current = null;

    if (!pendingRootIndexes || pendingRootIndexes.size === 0) {
      return;
    }

    scheduleDecorations([...pendingRootIndexes]);
  });

  const scheduleDecorationsForTransition = useEffectEvent((transition: EditorStateTransition) => {
    if (!decorationsEnabled) {
      return;
    }

    if (!transition.documentChanged || transition.changedRootIndexes.length === 0) {
      return;
    }

    const pendingRootIndexes = pendingDecorationRootIndexesRef.current ?? new Set<number>();
    pendingDecorationRootIndexesRef.current = pendingRootIndexes;

    for (const rootIndex of transition.changedRootIndexes) {
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

  /* Worker lifecycle */

  useEffect(() => {
    return () => {
      clearPendingDecorationRequest();
      decorationWorkerRef.current?.dispose();
      decorationWorkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (decorationsEnabled) {
      return;
    }

    clearPendingDecorationRequest();
    decorationWorkerRef.current?.dispose();
    decorationWorkerRef.current = null;
    clearTextDecorations();
  }, [decorationsEnabled]);

  /* Generation refresh */

  useEffect(() => {
    if (!decorationsEnabled) {
      return;
    }

    scheduleDecorations(undefined, true);
  }, [contentDocument, decorationRulesKey, decorationsEnabled]);

  /* Public API */

  return { scheduleDecorationsForTransition, textDecorations };
}
