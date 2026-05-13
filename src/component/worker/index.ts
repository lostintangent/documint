import { resolveBlockDecorationRanges } from "../decorations/ranges";
import { deserializeDecorationRules, type DocumintDecoration } from "../decorations/rules";
import type {
  DecorationRootResult,
  DecorationRootSnapshot,
  DecorationWorkerRequest,
  DecorationWorkerResponse,
} from "./protocol";

declare const self: {
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<DecorationWorkerRequest>) => void,
  ) => void;
  postMessage: (response: DecorationWorkerResponse) => void;
};

let configuredRules: readonly DocumintDecoration[] = [];
let configuredRulesKey = "";

self.addEventListener("message", (event) => {
  const request = event.data;

  if (request.kind === "configure-decorations") {
    configuredRules = deserializeDecorationRules(request.rules);
    configuredRulesKey = request.rulesKey;
    return;
  }

  if (request.kind !== "apply-decorations") {
    return;
  }

  try {
    if (request.rulesKey !== configuredRulesKey) {
      throw new Error("Decoration worker rules are not configured.");
    }

    const roots = applyDecorationsToRoots(request.roots, configuredRules);
    const response: DecorationWorkerResponse = {
      kind: "decoration-result",
      requestId: request.requestId,
      roots,
      rulesKey: request.rulesKey,
    };
    self.postMessage(response);
  } catch (error) {
    const response: DecorationWorkerResponse = {
      kind: "decoration-error",
      message: error instanceof Error ? error.message : "Unknown decoration worker error.",
      requestId: request.requestId,
      rulesKey: request.rulesKey,
    };
    self.postMessage(response);
  }
});

function applyDecorationsToRoots(
  roots: DecorationRootSnapshot[],
  rules: readonly DocumintDecoration[],
): DecorationRootResult[] {
  return roots.map((root) => ({
    ranges: resolveBlockDecorationRanges(root.block, root.rootIndex, rules),
    rootIndex: root.rootIndex,
    sourceKey: root.sourceKey,
  }));
}
