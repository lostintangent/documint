// Shared test harness for canvas paint tests. Painters draw into a
// CanvasRenderingContext2D; rather than rendering to a real canvas, the tests
// stub one out that records every fill/stroke/text call as a typed operation
// and then assert against the recorded sequence.

type RecordedPathCommand = {
  kind: "lineTo" | "moveTo";
  x: number;
  y: number;
};

export type RecordingOperation =
  | {
      kind: "fillRect";
      fillStyle: string | CanvasGradient | CanvasPattern;
      globalAlpha: number;
      height: number;
      width: number;
      x: number;
      y: number;
    }
  | {
      endAngle: number;
      kind: "arc";
      radius: number;
      startAngle: number;
      x: number;
      y: number;
    }
  | {
      fillStyle: string | CanvasGradient | CanvasPattern;
      globalAlpha: number;
      kind: "fillPath";
    }
  | {
      font: string;
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
    }
  | {
      kind: "strokePath";
      lineWidth: number;
      path: readonly RecordedPathCommand[];
      strokeStyle: string | CanvasGradient | CanvasPattern;
    };

export class RecordingCanvasContext {
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  font = "";
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = "source-over";
  lineWidth = 1;
  operations: RecordingOperation[] = [];
  private pendingPath: RecordedPathCommand[] = [];
  private pendingRoundedRect: { height: number; width: number; x: number; y: number } | null = null;
  private stateStack: Array<{
    fillStyle: string | CanvasGradient | CanvasPattern;
    font: string;
    globalAlpha: number;
    globalCompositeOperation: GlobalCompositeOperation;
    lineCap: CanvasLineCap;
    lineJoin: CanvasLineJoin;
    lineWidth: number;
    strokeStyle: string | CanvasGradient | CanvasPattern;
    textAlign: CanvasTextAlign;
    textBaseline: CanvasTextBaseline;
  }> = [];
  lineCap: CanvasLineCap = "butt";
  lineJoin: CanvasLineJoin = "miter";
  strokeStyle: string | CanvasGradient | CanvasPattern = "";
  textAlign: CanvasTextAlign = "start";
  textBaseline: CanvasTextBaseline = "alphabetic";

  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number) {
    this.operations.push({
      endAngle,
      kind: "arc",
      radius,
      startAngle,
      x,
      y,
    });
  }

  beginPath() {
    this.pendingPath = [];
    this.pendingRoundedRect = null;
  }

  clearRect() {}

  clip() {}

  createLinearGradient(): CanvasGradient {
    return {
      addColorStop() {},
    } as CanvasGradient;
  }

  fill() {
    if (!this.pendingRoundedRect) {
      this.operations.push({
        fillStyle: this.fillStyle,
        globalAlpha: this.globalAlpha,
        kind: "fillPath",
      });
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
      globalAlpha: this.globalAlpha,
      height,
      kind: "fillRect",
      width,
      x,
      y,
    });
  }

  fillText(text: string, x: number, y: number) {
    this.operations.push({
      font: this.font,
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

  lineTo(x: number, y: number) {
    this.pendingPath.push({ kind: "lineTo", x, y });
  }

  measureText(text: string) {
    return {
      actualBoundingBoxAscent: 10,
      actualBoundingBoxDescent: 3,
      width: text.length * 8,
    } as TextMetrics;
  }

  moveTo(x: number, y: number) {
    this.pendingPath.push({ kind: "moveTo", x, y });
  }

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
    this.lineCap = state.lineCap;
    this.lineJoin = state.lineJoin;
    this.lineWidth = state.lineWidth;
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
      lineCap: this.lineCap,
      lineJoin: this.lineJoin,
      lineWidth: this.lineWidth,
      strokeStyle: this.strokeStyle,
      textAlign: this.textAlign,
      textBaseline: this.textBaseline,
    });
  }

  scale() {}

  stroke() {
    this.operations.push({
      kind: "strokePath",
      lineWidth: this.lineWidth,
      path: this.pendingPath,
      strokeStyle: this.strokeStyle,
    });
    this.pendingPath = [];
  }

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
