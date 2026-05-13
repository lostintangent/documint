// Shared test harness for canvas paint tests. Painters draw into a
// CanvasRenderingContext2D; rather than rendering to a real canvas, the tests
// stub one out that records every fill/stroke/text call as a typed operation
// and then assert against the recorded sequence.

export type RecordingOperation =
  | {
      kind: "fillRect";
      fillStyle: string | CanvasGradient | CanvasPattern;
      height: number;
      width: number;
      x: number;
      y: number;
    }
  | {
      fillStyle: string | CanvasGradient | CanvasPattern;
      globalCompositeOperation: GlobalCompositeOperation;
      globalAlpha: number;
      kind: "fillText";
      text: string;
      textAlign: CanvasTextAlign;
      x: number;
      y: number;
    }
  | {
      kind: "strokeRect";
      strokeStyle: string | CanvasGradient | CanvasPattern;
      height: number;
      width: number;
      x: number;
      y: number;
    };

export class RecordingCanvasContext {
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  font = "";
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = "source-over";
  lineWidth = 1;
  operations: RecordingOperation[] = [];
  private pendingRoundedRect: { height: number; width: number; x: number; y: number } | null = null;
  private stateStack: Array<{
    fillStyle: string | CanvasGradient | CanvasPattern;
    font: string;
    globalAlpha: number;
    globalCompositeOperation: GlobalCompositeOperation;
    strokeStyle: string | CanvasGradient | CanvasPattern;
    textAlign: CanvasTextAlign;
    textBaseline: CanvasTextBaseline;
  }> = [];
  strokeStyle: string | CanvasGradient | CanvasPattern = "";
  textAlign: CanvasTextAlign = "start";
  textBaseline: CanvasTextBaseline = "alphabetic";

  arc() {}

  beginPath() {
    this.pendingRoundedRect = null;
  }

  clearRect() {}

  clip() {}

  fill() {
    if (!this.pendingRoundedRect) {
      return;
    }

    this.fillRect(
      this.pendingRoundedRect.x,
      this.pendingRoundedRect.y,
      this.pendingRoundedRect.width,
      this.pendingRoundedRect.height,
    );
    this.pendingRoundedRect = null;
  }

  fillRect(x: number, y: number, width: number, height: number) {
    this.operations.push({
      fillStyle: this.fillStyle,
      height,
      kind: "fillRect",
      width,
      x,
      y,
    });
  }

  fillText(text: string, x: number, y: number) {
    this.operations.push({
      fillStyle: this.fillStyle,
      globalCompositeOperation: this.globalCompositeOperation,
      globalAlpha: this.globalAlpha,
      kind: "fillText",
      text,
      textAlign: this.textAlign,
      x,
      y,
    });
  }

  lineTo() {}

  measureText(text: string) {
    return {
      actualBoundingBoxAscent: 10,
      actualBoundingBoxDescent: 3,
      width: text.length * 8,
    } as TextMetrics;
  }

  moveTo() {}

  rect() {}

  restore() {
    const state = this.stateStack.pop();

    if (!state) {
      return;
    }

    this.fillStyle = state.fillStyle;
    this.font = state.font;
    this.globalAlpha = state.globalAlpha;
    this.globalCompositeOperation = state.globalCompositeOperation;
    this.strokeStyle = state.strokeStyle;
    this.textAlign = state.textAlign;
    this.textBaseline = state.textBaseline;
  }

  roundRect(x: number, y: number, width: number, height: number) {
    this.pendingRoundedRect = { height, width, x, y };
  }

  save() {
    this.stateStack.push({
      fillStyle: this.fillStyle,
      font: this.font,
      globalAlpha: this.globalAlpha,
      globalCompositeOperation: this.globalCompositeOperation,
      strokeStyle: this.strokeStyle,
      textAlign: this.textAlign,
      textBaseline: this.textBaseline,
    });
  }

  scale() {}

  stroke() {}

  strokeRect(x: number, y: number, width: number, height: number) {
    this.operations.push({
      height,
      kind: "strokeRect",
      strokeStyle: this.strokeStyle,
      width,
      x,
      y,
    });
  }

  translate() {}
}

export function approximately(left: number, right: number, epsilon = 0.01) {
  return Math.abs(left - right) <= epsilon;
}

export function findOperationIndex(
  operations: RecordingOperation[],
  predicate: (operation: RecordingOperation) => boolean,
) {
  return operations.findIndex(predicate);
}

export function findLastOperationIndex(
  operations: RecordingOperation[],
  predicate: (operation: RecordingOperation) => boolean,
) {
  for (let index = operations.length - 1; index >= 0; index -= 1) {
    if (predicate(operations[index]!)) {
      return index;
    }
  }

  return -1;
}

export function findFillTextOperation(operations: RecordingOperation[], text: string) {
  const operation = operations.find((candidate) => {
    return candidate.kind === "fillText" && candidate.text === text;
  });

  return operation?.kind === "fillText" ? operation : null;
}
