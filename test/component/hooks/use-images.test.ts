import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { loadImage } from "@/component/hooks/useImages";
import { DocumentStorage } from "@/component/lib/storage";

const storage = new DocumentStorage(
  { readFile: async () => null, writeFile: async () => "" },
  null,
);
const stubbedGlobals = ["Image", "OffscreenCanvas", "window"];
const originalGlobals = stubbedGlobals.map((name) => Reflect.get(globalThis, name));
let imageSources: string[];
let naturalSize: [number, number];

// Bun can't decode images, so these stubs decode anything through an `<img>`.
beforeEach(() => {
  imageSources = [];
  naturalSize = [88, 20];
  Object.assign(globalThis, {
    Image: class {
      naturalHeight = naturalSize[1];
      naturalWidth = naturalSize[0];
      src = "";
      async decode() {
        imageSources.push(this.src);
      }
    },
    OffscreenCanvas: function (width: number, height: number) {
      return {
        getContext: () => ({ drawImage() {} }),
        transferToImageBitmap: () => ({ height, width }),
      };
    },
    window: { devicePixelRatio: 2 },
  });
});

afterEach(() => {
  mock.restore();
  stubbedGlobals.forEach((name, index) => Reflect.set(globalThis, name, originalGlobals[index]));
});

describe("loadImage", () => {
  test.each([
    ["https://github.com/websockets/ws/workflows/CI/badge.svg", [88, 20], [176, 40]],
    ["https://user-images.githubusercontent.com/71256/shot.png", [1294, 924], [1294, 924]],
  ])("decodes %s through its URL when fetch fails", async (url, natural, bitmap) => {
    naturalSize = natural as [number, number];
    spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    expect(await loadImage(url, storage)).toEqual({
      bitmap: { height: bitmap[1], width: bitmap[0] } as ImageBitmap,
      height: natural[1],
      width: natural[0],
    });
    expect(imageSources).toEqual([url]);
  });

  test("leaves host paths to host storage", async () => {
    expect(await loadImage("./logo.svg", storage)).toBeNull();
    expect(imageSources).toEqual([]);
  });
});
