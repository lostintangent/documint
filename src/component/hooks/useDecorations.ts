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

const decorationTransitionDebounceMs = 220;
const emptyDecorationRules: readonly DocumintDecoration[] = [];
const emptyTextDecorations: TextDecorationIndex = new Map();

export type { DocumintDecoration } from "../decorations/rules";

type UseDecorationsOptions = {
  contentDocument: Document;
  decorations?: readonly DocumintDecoration[];
  store: DocumintStore;
};

export function useDecorations({ contentDocument, decorations, store }: UseDecorationsOptions) {
  const decorationClientRef = useRef<DecorationWorkerClient | null>(null);
  const pendingRootIndexesRef = useRef<Set<number> | null>(null);
  const pendingScheduleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const decorationRules = useMemo(() => {
    const effectiveRules = decorations?.filter(hasDecorationRuleStyle) ?? emptyDecorationRules;
    return effectiveRules.length === 0 ? emptyDecorationRules : effectiveRules;
  }, [decorations]);
  const decorationsEnabled = decorationRules.length > 0;
  const decorationRulesKey = useMemo(
    () => resolveDecorationRulesKey(decorationRules),
    [decorationRules],
  );
  const [textDecorations, setTextDecorations] = useState<TextDecorationIndex>(
    () => emptyTextDecorations,
  );

  const clearPendingDecorationSchedule = () => {
    if (pendingScheduleTimeoutRef.current !== null) {
      clearTimeout(pendingScheduleTimeoutRef.current);
      pendingScheduleTimeoutRef.current = null;
    }
    pendingRootIndexesRef.current = null;
  };

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

  const scheduleDecorations = useEffectEvent(
    (rootIndexes?: readonly number[], refreshGeneration = false) => {
      if (refreshGeneration) {
        clearPendingDecorationSchedule();
      }

      if (!decorationsEnabled) {
        setTextDecorations((current) => (current.size === 0 ? current : emptyTextDecorations));
        return;
      }

      const currentState = store.editor.getState();
      const roots = resolveDecorationRootSnapshots(
        currentState.documentIndex.document,
        rootIndexes,
      );

      if (roots.length === 0) {
        setTextDecorations((current) => (current.size === 0 ? current : emptyTextDecorations));
        return;
      }

      const client = decorationClientRef.current ?? createDecorationWorkerClient();

      if (!client) {
        setTextDecorations((current) => (current.size === 0 ? current : emptyTextDecorations));
        return;
      }

      decorationClientRef.current = client;

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
          if (decorationClientRef.current === client) {
            decorationClientRef.current = null;
          }
          setTextDecorations((current) => (current.size === 0 ? current : emptyTextDecorations));

          if (process.env.NODE_ENV !== "production") {
            emitDiagnostic("decorationError", {
              message: error instanceof Error ? error.message : String(error),
            });
          }
        });
    },
  );

  const flushPendingDecorations = useEffectEvent(() => {
    const pendingRootIndexes = pendingRootIndexesRef.current;
    pendingRootIndexesRef.current = null;
    pendingScheduleTimeoutRef.current = null;

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

    const pendingRootIndexes = pendingRootIndexesRef.current ?? new Set<number>();
    pendingRootIndexesRef.current = pendingRootIndexes;

    for (const rootIndex of transition.changedRootIndexes) {
      pendingRootIndexes.add(rootIndex);
    }

    if (pendingScheduleTimeoutRef.current !== null) {
      clearTimeout(pendingScheduleTimeoutRef.current);
    }

    pendingScheduleTimeoutRef.current = setTimeout(
      flushPendingDecorations,
      decorationTransitionDebounceMs,
    );
  });

  useEffect(() => {
    return () => {
      clearPendingDecorationSchedule();
      decorationClientRef.current?.dispose();
      decorationClientRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (decorationsEnabled) {
      return;
    }

    clearPendingDecorationSchedule();
    decorationClientRef.current?.dispose();
    decorationClientRef.current = null;
    setTextDecorations((current) => (current.size === 0 ? current : emptyTextDecorations));
  }, [decorationsEnabled]);

  useEffect(() => {
    if (!decorationsEnabled) {
      return;
    }

    scheduleDecorations(undefined, true);
  }, [contentDocument, decorationRulesKey, decorationsEnabled]);

  return { scheduleDecorationsForTransition, textDecorations };
}
