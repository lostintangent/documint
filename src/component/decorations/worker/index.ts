import {
  compileDecorations,
} from "./matching";
import { deserializeDecorations } from "./config";
import type { DocumintDecoration } from "@/types";
import { compileCodeGrammars, resolveCodeDecorationRanges } from "./code";
import { resolveCompiledBlockDecorationRanges } from "./prose";
import type {
  DecorationRootResult,
  DecorationRootSnapshot,
  DecorationWorkerRequest,
  DecorationWorkerResponse,
  SerializedDecoration,
} from "../shared";

declare const self: {
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<DecorationWorkerRequest>) => void,
  ) => void;
  postMessage: (response: DecorationWorkerResponse) => void;
};

let configuredDecorations: readonly DocumintDecoration[] = [];
let configuredCodeGrammars: Record<string, DocumintDecoration[]> = {};
let configuredKey: string | null = null;

self.addEventListener("message", (event) => {
  const request = event.data;

  if (request.kind === "configure-decorations") {
    configuredDecorations = compileDecorations(deserializeDecorations(request.decorations));
    configuredCodeGrammars = deserializeCodeGrammars(request.codeGrammars);
    configuredKey = request.configKey;
    return;
  }

  if (request.kind !== "apply-decorations") {
    return;
  }

  try {
    if (request.configKey !== configuredKey) {
      throw new Error("Decoration worker config is not configured.");
    }

    const roots = applyDecorationsToRoots(
      request.roots,
      configuredDecorations,
      configuredCodeGrammars,
    );
    const response: DecorationWorkerResponse = {
      kind: "decoration-result",
      configKey: request.configKey,
      requestId: request.requestId,
      roots,
    };
    self.postMessage(response);
  } catch (error) {
    const response: DecorationWorkerResponse = {
      kind: "decoration-error",
      configKey: request.configKey,
      message: error instanceof Error ? error.message : "Unknown decoration worker error.",
      requestId: request.requestId,
    };
    self.postMessage(response);
  }
});

function applyDecorationsToRoots(
  roots: DecorationRootSnapshot[],
  decorations: readonly DocumintDecoration[],
  codeGrammars: Record<string, readonly DocumintDecoration[]>,
): DecorationRootResult[] {
  return roots.map((root) => ({
    // Invariant: prose and code passes occupy disjoint paths — host
    // decorations match inline text (which skips leaf code blocks) while code
    // grammar decorations match source blocks — so concatenating them never
    // yields overlapping ranges on one path. If host decorations ever target
    // code, this needs an explicit layering rule instead of a plain concat.
    ranges: [
      ...resolveCompiledBlockDecorationRanges(root.block, root.rootIndex, decorations),
      ...resolveCodeDecorationRanges(root.block, root.rootIndex, codeGrammars),
    ],
    rootIndex: root.rootIndex,
    sourceKey: root.sourceKey,
  }));
}

// Reconstructs the wire config into runnable grammars: deserialize each
// language's decorations, then compile them for source matching.
function deserializeCodeGrammars(
  serialized: Record<string, SerializedDecoration[]>,
): Record<string, DocumintDecoration[]> {
  const decorationsByLanguage: Record<string, readonly DocumintDecoration[]> = {};
  for (const [language, decorations] of Object.entries(serialized)) {
    decorationsByLanguage[language] = deserializeDecorations(decorations);
  }
  return compileCodeGrammars(decorationsByLanguage);
}
