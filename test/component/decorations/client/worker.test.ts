import { describe, expect, test } from "bun:test";
import { createDocument, createParagraphTextBlock } from "@/document";
import {
  createDecorationWorkerClient,
  type DecorationRequest,
} from "@/component/decorations/client/worker";
import type {
  DecorationWorkerRequest,
  DecorationWorkerResponse,
} from "@/component/decorations/shared";

describe("DecorationWorkerClient", () => {
  test("posts plain rule fields and pairs worker ranges with their snapshot roots", async () => {
    const worker = new FakeDecorationWorker();
    const client = createDecorationWorkerClient({ createWorker: () => worker });
    const hostRule = Object.assign(
      { color: "red", pattern: /\blist\b/g },
      { label: "not cloneable", onMatch: () => {} },
    );
    const codeGrammars = {
      tree: [
        { color: "green", pattern: /&+/ },
        { backgroundColor: "gold", pulse: true, pattern: /_+/ },
      ],
    };
    const request = { ...createDecorationRequest(), codeGrammars, decorations: [hostRule] };
    const promise = client.run(request);

    // toEqual also rejects the host-only label and onMatch fields.
    expect(worker.messages).toEqual([
      {
        kind: "configure-decorations",
        codeGrammars,
        decorations: [{ color: "red", pattern: /\blist\b/g }],
      },
      { kind: "apply-decorations", requestId: 1, roots: request.roots },
    ]);
    worker.emitMessage({
      kind: "decoration-result",
      ranges: [[{ color: "red", endOffset: 6, path: "root:0", startOffset: 2 }]],
      requestId: 1,
    });

    const [result] = await promise;
    expect(result!.block).toBe(request.roots[0]!.block);
    expect(result).toEqual({
      block: request.roots[0]!.block,
      ranges: [{ color: "red", endOffset: 6, path: "root:0", startOffset: 2 }],
      rootIndex: 0,
    });
  });

  test("configures the worker on the first request, even with an empty key, and on key changes", async () => {
    const worker = new FakeDecorationWorker();
    const client = createDecorationWorkerClient({ createWorker: () => worker });

    const first = client.run({ ...createDecorationRequest(), configKey: "" });
    worker.emitMessage({ kind: "decoration-result", ranges: [[]], requestId: 1 });
    await first;

    const second = client.run({ ...createDecorationRequest(), configKey: "" });
    worker.emitMessage({ kind: "decoration-result", ranges: [[]], requestId: 2 });
    await second;

    const third = client.run({ ...createDecorationRequest(), configKey: "next" });
    worker.emitMessage({ kind: "decoration-result", ranges: [[]], requestId: 3 });
    await third;

    expect(worker.messages.map((message) => message.kind)).toEqual([
      "configure-decorations",
      "apply-decorations",
      "apply-decorations",
      "configure-decorations",
      "apply-decorations",
    ]);
  });

  test("rejects the matching job when the worker reports an error", async () => {
    const worker = new FakeDecorationWorker();
    const client = createDecorationWorkerClient({ createWorker: () => worker });
    const promise = client.run(createDecorationRequest());

    worker.emitMessage({ kind: "decoration-error", message: "bad pattern", requestId: 1 });

    expect((await expectRejected(promise)).message).toBe("bad pattern");
    expect(worker.terminated).toBe(false);
  });

  test("terminates the worker when a job times out", async () => {
    const worker = new FakeDecorationWorker();
    const client = createDecorationWorkerClient({ createWorker: () => worker, timeoutMs: 1 });

    const error = await expectRejected(client.run(createDecorationRequest()));

    expect(error.message).toContain("timed out");
    expect(worker.terminated).toBe(true);

    const nextError = await expectRejected(client.run(createDecorationRequest()));
    expect(nextError.message).toContain("terminated");
  });

  test("rejects pending jobs when disposed", async () => {
    const worker = new FakeDecorationWorker();
    const client = createDecorationWorkerClient({ createWorker: () => worker });
    const promise = client.run(createDecorationRequest());

    client.dispose();
    const error = await expectRejected(promise);

    expect(error.message).toContain("disposed");
    expect(worker.terminated).toBe(true);
  });
});

class FakeDecorationWorker {
  readonly messages: DecorationWorkerRequest[] = [];
  private readonly messageListeners: Array<
    (event: MessageEvent<DecorationWorkerResponse>) => void
  > = [];
  private readonly errorListeners: Array<(event: ErrorEvent) => void> = [];
  terminated = false;

  addEventListener(
    type: "message",
    listener: (event: MessageEvent<DecorationWorkerResponse>) => void,
  ): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(
    type: "message" | "error",
    listener:
      | ((event: MessageEvent<DecorationWorkerResponse>) => void)
      | ((event: ErrorEvent) => void),
  ) {
    if (type === "message") {
      this.messageListeners.push(
        listener as (event: MessageEvent<DecorationWorkerResponse>) => void,
      );
    } else {
      this.errorListeners.push(listener as (event: ErrorEvent) => void);
    }
  }

  postMessage(message: DecorationWorkerRequest) {
    this.messages.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  emitMessage(response: DecorationWorkerResponse) {
    for (const listener of this.messageListeners) {
      listener({ data: response } as MessageEvent<DecorationWorkerResponse>);
    }
  }
}

function createDecorationRequest(): DecorationRequest {
  const document = createDocument([createParagraphTextBlock("A list item")]);

  return {
    codeGrammars: {},
    configKey: "decorations",
    decorations: [{ color: "red", pattern: /\blist\b/ }],
    roots: [{ block: document.blocks[0]!, rootIndex: 0 }],
  };
}

async function expectRejected(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`Expected Error rejection, received ${String(error)}`);
  }

  throw new Error("Expected promise to reject.");
}
