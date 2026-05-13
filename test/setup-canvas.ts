class TestCanvasMeasurementContext {
  font = "";

  measureText(text: string) {
    const { ascent, descent } = measureTestFontMetrics(this.font);

    return {
      actualBoundingBoxAscent: ascent,
      actualBoundingBoxDescent: descent,
      width: measureTestTextWidth(text, this.font),
    } as TextMetrics;
  }
}

class TestOffscreenCanvas {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  getContext(contextType: string) {
    return contextType === "2d" ? new TestCanvasMeasurementContext() : null;
  }
}

if (typeof globalThis.OffscreenCanvas === "undefined") {
  Object.defineProperty(globalThis, "OffscreenCanvas", {
    configurable: true,
    value: TestOffscreenCanvas,
    writable: true,
  });
}

function measureTestTextWidth(text: string, font: string) {
  const fontScale = font.includes("700") ? 1.08 : 1;
  let width = 0;

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);

    if (isHighSurrogate(code) && index + 1 < text.length) {
      width += 18;
      index += 1;
      continue;
    }

    width += measureTestTextUnitWidth(code);
  }

  return width * fontScale;
}

function measureTestFontMetrics(font: string) {
  const fontSize = resolveTestCanvasFontSize(font);
  const emHeight = Math.max(12, Math.round(fontSize));
  const ascent = Math.max(10, Math.round(emHeight * 0.8));

  return {
    ascent,
    descent: Math.max(2, emHeight - ascent),
  };
}

function resolveTestCanvasFontSize(font: string) {
  const match = /(\d+(?:\.\d+)?)\s*px/.exec(font);

  return match ? Number.parseFloat(match[1]!) : 16;
}

function measureTestTextUnitWidth(code: number) {
  if (code === 0x09) return 32;
  if (code === 0x0a) return 0;
  if (code === 0x20) return 4;

  switch (code) {
    case 0x23:
    case 0x25:
    case 0x26:
    case 0x40:
    case 0x4d:
    case 0x57:
    case 0x6d:
    case 0x77:
      return 10;
    case 0x27:
    case 0x2c:
    case 0x2e:
    case 0x60:
    case 0x69:
    case 0x6c:
      return 4;
  }

  return 8;
}

function isHighSurrogate(code: number) {
  return code >= 0xd800 && code <= 0xdbff;
}
