import type { Block } from "@/document";
import type { DecorationRange } from "../decorations/ranges";
import type { SerializedDecorationRule } from "../decorations/rules";

export type DecorationRootSnapshot = {
  block: Block;
  rootIndex: number;
  sourceKey: string;
};

export type DecorationRootResult = {
  ranges: DecorationRange[];
  rootIndex: number;
  sourceKey: string;
};

export type DecorationWorkerRequest =
  | {
      kind: "configure-decorations";
      rules: SerializedDecorationRule[];
      rulesKey: string;
    }
  | {
      kind: "apply-decorations";
      requestId: number;
      roots: DecorationRootSnapshot[];
      rulesKey: string;
    };

export type DecorationWorkerResponse =
  | {
      kind: "decoration-result";
      requestId: number;
      roots: DecorationRootResult[];
      rulesKey: string;
    }
  | {
      kind: "decoration-error";
      requestId: number;
      message: string;
      rulesKey: string;
    };
