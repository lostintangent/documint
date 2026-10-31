import type { Block } from "@/document";
import type { TextDecoration } from "@/editor";

export type DocumintDecoration = {
  backgroundColor?: string;
  pulse?: boolean;
  color?: string;
  pattern: RegExp;
};

export type DecorationRootSnapshot = {
  block: Block;
  rootIndex: number;
};

// A worker result paired with the snapshot it classified. Blocks are immutable,
// so the result still applies exactly when the current root is the same object.
export type DecorationRootResult = DecorationRootSnapshot & {
  ranges: TextDecoration[];
};

// Rules cross the worker boundary as plain objects; structured clone keeps
// their RegExp patterns intact.
export type DecorationWorkerRequest =
  | {
      kind: "configure-decorations";
      codeGrammars: Record<string, DocumintDecoration[]>;
      decorations: DocumintDecoration[];
    }
  | {
      kind: "apply-decorations";
      requestId: number;
      roots: DecorationRootSnapshot[];
    };

// `ranges[i]` classifies `roots[i]` from the matching apply request.
export type DecorationWorkerResponse =
  | {
      kind: "decoration-result";
      ranges: TextDecoration[][];
      requestId: number;
    }
  | {
      kind: "decoration-error";
      message: string;
      requestId: number;
    };

export function isValidDecoration(
  decoration: Pick<DocumintDecoration, "backgroundColor" | "color">,
) {
  return Boolean(decoration.backgroundColor || decoration.color);
}
