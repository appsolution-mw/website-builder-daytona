import { describe, expect, it } from "vitest";
import {
  isUsableCaptureRect,
  normalizeDragRect,
  viewportRectToVideoCrop,
  type CaptureRect,
} from "../preview-capture";

describe("preview capture geometry", () => {
  it("normalizes a dragged rectangle and clamps it to the preview bounds", () => {
    const bounds: CaptureRect = { x: 100, y: 100, width: 300, height: 200 };

    expect(normalizeDragRect({ x: 220, y: 120 }, { x: 80, y: 260 }, bounds)).toEqual({
      x: 100,
      y: 120,
      width: 120,
      height: 140,
    });
  });

  it("maps viewport selection coordinates into captured video pixels", () => {
    const viewport: CaptureRect = { x: 0, y: 0, width: 1200, height: 800 };
    const selection: CaptureRect = { x: 300, y: 160, width: 240, height: 120 };

    expect(viewportRectToVideoCrop(selection, viewport, { width: 2400, height: 1600 })).toEqual({
      x: 600,
      y: 320,
      width: 480,
      height: 240,
    });
  });

  it("rejects accidental tiny selections", () => {
    expect(isUsableCaptureRect({ x: 0, y: 0, width: 7, height: 20 })).toBe(false);
    expect(isUsableCaptureRect({ x: 0, y: 0, width: 80, height: 8 })).toBe(true);
  });
});
