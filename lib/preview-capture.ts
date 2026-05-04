export type CapturePoint = {
  x: number;
  y: number;
};

export type CaptureRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type VideoSize = {
  width: number;
  height: number;
};

const MIN_CAPTURE_SIDE = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeDragRect(
  start: CapturePoint,
  current: CapturePoint,
  bounds: CaptureRect,
): CaptureRect {
  const minX = bounds.x;
  const minY = bounds.y;
  const maxX = bounds.x + bounds.width;
  const maxY = bounds.y + bounds.height;
  const startX = clamp(start.x, minX, maxX);
  const startY = clamp(start.y, minY, maxY);
  const currentX = clamp(current.x, minX, maxX);
  const currentY = clamp(current.y, minY, maxY);

  return {
    x: Math.min(startX, currentX),
    y: Math.min(startY, currentY),
    width: Math.abs(currentX - startX),
    height: Math.abs(currentY - startY),
  };
}

export function viewportRectToVideoCrop(
  selection: CaptureRect,
  viewport: CaptureRect,
  video: VideoSize,
): CaptureRect {
  const scaleX = video.width / viewport.width;
  const scaleY = video.height / viewport.height;
  const x = clamp(Math.round((selection.x - viewport.x) * scaleX), 0, video.width);
  const y = clamp(Math.round((selection.y - viewport.y) * scaleY), 0, video.height);
  const width = clamp(Math.round(selection.width * scaleX), 0, video.width - x);
  const height = clamp(Math.round(selection.height * scaleY), 0, video.height - y);

  return { x, y, width, height };
}

export function isUsableCaptureRect(rect: CaptureRect): boolean {
  return rect.width >= MIN_CAPTURE_SIDE && rect.height >= MIN_CAPTURE_SIDE;
}
