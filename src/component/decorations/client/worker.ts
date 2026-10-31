import { bundleDecorationWorker } from "@macros/decoration-worker" with { type: "macro" };
import type {
  DecorationRootResult,
  DecorationRootSnapshot,
  DecorationWorkerRequest,
  DecorationWorkerResponse,
  DocumintDecoration,
} from "../shared";

const workerSource = process.env.NODE_ENV === "test" ? "" : bundleDecorationWorker();
const decorationJobTimeoutMs = 2000;

type DecorationWorkerHandle = {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<DecorationWorkerResponse>) => void,
  ): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  postMessage(message: DecorationWorkerRequest): void;
  terminate(): void;
};

type DecorationWorkerClientOptions = {
  createWorker?: () => DecorationWorkerHandle;
  timeoutMs?: number;
};

type PendingDecorationRequest = {
  reject: (error: Error) => void;
  resolve: (results: DecorationRootResult[]) => void;
  roots: DecorationRootSnapshot[];
  timeoutId: ReturnType<typeof setTimeout>;
};

export type DecorationRequest = {
  codeGrammars: Record<string, DocumintDecoration[]>;
  // Identifies the complete configured decoration inputs: host prose
  // decorations plus resolved per-language code grammar decorations. The
  // worker is reconfigured only when this changes.
  configKey: string;
  decorations: readonly DocumintDecoration[];
  roots: DecorationRootSnapshot[];
};

export type DecorationWorkerClient = {
  dispose: () => void;
  run: (request: DecorationRequest) => Promise<DecorationRootResult[]>;
};

export function createDecorationWorkerClient(
  options: DecorationWorkerClientOptions = {},
): DecorationWorkerClient {
  const worker = (options.createWorker ?? createDecorationWorker)();
  const timeoutMs = options.timeoutMs ?? decorationJobTimeoutMs;
  let terminated = false;
  let configuredKey: string | null = null;
  let nextRequestId = 1;
  const pending = new Map<number, PendingDecorationRequest>();

  function terminateWithError(error: Error) {
    if (terminated) return;
    terminated = true;
    worker.terminate();

    for (const [requestId, entry] of pending) {
      pending.delete(requestId);
      clearTimeout(entry.timeoutId);
      entry.reject(error);
    }
  }

  worker.addEventListener("message", (event: MessageEvent<DecorationWorkerResponse>) => {
    const response = event.data;
    const entry = pending.get(response.requestId);
    if (!entry) return;

    pending.delete(response.requestId);
    clearTimeout(entry.timeoutId);

    if (response.kind === "decoration-error") {
      entry.reject(new Error(response.message));
      return;
    }

    entry.resolve(
      entry.roots.map((root, index) => ({ ...root, ranges: response.ranges[index] ?? [] })),
    );
  });

  worker.addEventListener("error", (event) => {
    terminateWithError(new Error(event.message || "Decoration worker failed."));
  });

  return {
    dispose() {
      terminateWithError(new Error("Decoration worker disposed."));
    },

    run(request) {
      if (terminated) {
        return Promise.reject(new Error("Decoration worker terminated."));
      }

      const requestId = nextRequestId++;
      if (configuredKey !== request.configKey) {
        worker.postMessage({
          kind: "configure-decorations",
          codeGrammars: request.codeGrammars,
          decorations: copyDecorationRules(request.decorations),
        });
        configuredKey = request.configKey;
      }

      return new Promise<DecorationRootResult[]>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          // Terminate the worker — a pathological regex can spin forever.
          terminateWithError(new Error("Decoration worker job timed out."));
        }, timeoutMs);

        pending.set(requestId, { reject, resolve, roots: request.roots, timeoutId });
        worker.postMessage({ kind: "apply-decorations", requestId, roots: request.roots });
      });
    },
  };
}

// Host rule objects may carry extra fields that structured clone rejects, so
// only the rule fields cross the worker boundary.
function copyDecorationRules(rules: readonly DocumintDecoration[]): DocumintDecoration[] {
  return rules.map(({ backgroundColor, color, pattern, pulse }) => ({
    backgroundColor,
    color,
    pattern,
    pulse,
  }));
}

function createDecorationWorker(): DecorationWorkerHandle {
  const blob = new Blob([workerSource], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url, { type: "module" });
  URL.revokeObjectURL(url);
  return worker;
}
