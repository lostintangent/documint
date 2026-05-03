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
  lineWidth = 1;
  operations: RecordingOperation[] = [];
  strokeStyle: string | CanvasGradient | CanvasPattern = "";
  textAlign: CanvasTextAlign = "start";
  textBaseline: CanvasTextBaseline = "alphabetic";

  arc() {}

  beginPath() {}

  clearRect() {}

  fill() {}

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
      kind: "fillText",
      text,
      textAlign: this.textAlign,
      x,
      y,
    });
  }

  lineTo() {}

  moveTo() {}

  restore() {}

  roundRect() {}

  save() {}

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
