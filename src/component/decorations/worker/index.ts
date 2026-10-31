import type { TextDecoration } from "@/editor";
import { compileDecorations } from "./matching";
import { compileCodeGrammars, resolveCodeDecorationRanges } from "./code";
import { resolveCompiledBlockDecorationRanges } from "./prose";
import type {
  DecorationRootSnapshot,
  DecorationWorkerRequest,
  DecorationWorkerResponse,
  DocumintDecoration,
} from "../shared";

declare const self: {
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<DecorationWorkerRequest>) => void,
  ) => void;
  postMessage: (response: DecorationWorkerResponse) => void;
};

let configuredDecorations: readonly DocumintDecoration[] = [];
let configuredCodeGrammars: Record<string, readonly DocumintDecoration[]> = {};

self.addEventListener("message", (event) => {
  const request = event.data;

  // The client always configures before its first apply request, and worker
  // messages arrive in order, so apply requests run against current rules.
  if (request.kind === "configure-decorations") {
    configuredDecorations = compileDecorations(request.decorations);
    configuredCodeGrammars = compileCodeGrammars(request.codeGrammars);
    return;
  }

  try {
    self.postMessage({
      kind: "decoration-result",
      ranges: request.roots.map(resolveRootDecorationRanges),
      requestId: request.requestId,
    });
  } catch (error) {
    self.postMessage({
      kind: "decoration-error",
      message: error instanceof Error ? error.message : "Unknown decoration worker error.",
      requestId: request.requestId,
    });
  }
});

// Invariant: prose and code passes occupy disjoint paths — host decorations
// match inline text (which skips leaf code blocks) while code grammar
// decorations match source blocks — so concatenating them never yields
// overlapping ranges on one path. If host decorations ever target code, this
// needs an explicit layering rule instead of a plain concat.
function resolveRootDecorationRanges({
  block,
  rootIndex,
}: DecorationRootSnapshot): TextDecoration[] {
  return [
    ...resolveCompiledBlockDecorationRanges(block, rootIndex, configuredDecorations),
    ...resolveCodeDecorationRanges(block, rootIndex, configuredCodeGrammars),
  ];
}
