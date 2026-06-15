import type { Block } from "@/document";
import type { TextDecoration } from "@/editor";

export type SerializedDecoration = {
  backgroundColor?: string;
  pulse?: boolean;
  color?: string;
  flags: string;
  source: string;
};

export type DecorationRootSnapshot = {
  block: Block;
  rootIndex: number;
  sourceKey: string;
};

export type DecorationRootResult = {
  ranges: TextDecoration[];
  rootIndex: number;
  sourceKey: string;
};

export type DecorationWorkerRequest =
  | {
      kind: "configure-decorations";
      codeGrammars: Record<string, SerializedDecoration[]>;
      decorations: SerializedDecoration[];
      // Identifies the complete configured decoration inputs: host prose
      // decorations plus resolved per-language code grammar decorations. Apply
      // requests and results use this to avoid mixing roots with stale worker
      // configuration.
      configKey: string;
    }
  | {
      kind: "apply-decorations";
      configKey: string;
      requestId: number;
      roots: DecorationRootSnapshot[];
    };

export type DecorationWorkerResponse =
  | {
      kind: "decoration-result";
      configKey: string;
      requestId: number;
      roots: DecorationRootResult[];
    }
  | {
      kind: "decoration-error";
      configKey: string;
      requestId: number;
      message: string;
    };
