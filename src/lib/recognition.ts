import {
  NATURAL_NOTES,
  noteName,
  type Corners,
  type PaperControl,
  type Point,
} from "../types";
import { computeHomography, transformPoint, validateCorners } from "./geometry";

const UNIT_CORNERS: Corners = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

/** Capture once during setup. All sampling and detection happens in paper coordinates. */
export function rectifyImage(
  source: HTMLCanvasElement | HTMLVideoElement,
  corners: Corners,
  width = 720,
  height = 510,
): HTMLCanvasElement {
  if (!validateCorners(corners))
    throw new Error("Choose four convex paper corners in clockwise order.");
  const sourceWidth = "videoWidth" in source ? source.videoWidth : source.width;
  const sourceHeight =
    "videoHeight" in source ? source.videoHeight : source.height;
  if (sourceWidth <= 0 || sourceHeight <= 0)
    throw new Error("The camera has no image yet.");
  if (![width, height].every((value) => Number.isFinite(value) && value >= 2))
    throw new Error("Choose a valid capture size.");
  const capture = document.createElement("canvas");
  const scale = Math.min(1, 1280 / Math.max(sourceWidth, sourceHeight));
  capture.width = Math.max(2, Math.round(sourceWidth * scale));
  capture.height = Math.max(2, Math.round(sourceHeight * scale));
  const captureContext = capture.getContext("2d", { willReadFrequently: true });
  if (!captureContext)
    throw new Error("Canvas capture is unavailable in this browser.");
  captureContext.drawImage(source, 0, 0, capture.width, capture.height);
  const input = captureContext.getImageData(
    0,
    0,
    capture.width,
    capture.height,
  );
  const canvas = document.createElement("canvas");
  const outputScale = Math.min(1, 1024 / Math.max(width, height));
  canvas.width = Math.round(width * outputScale);
  canvas.height = Math.round(height * outputScale);
  const context = canvas.getContext("2d");
  if (!context)
    throw new Error("Canvas capture is unavailable in this browser.");
  const output = context.createImageData(canvas.width, canvas.height);
  const matrix = computeHomography(UNIT_CORNERS, corners);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const projected = transformPoint(matrix, [
        x / (canvas.width - 1),
        y / (canvas.height - 1),
      ]);
      const sx = Math.max(
        0,
        Math.min(capture.width - 1, projected[0] * (capture.width - 1)),
      );
      const sy = Math.max(
        0,
        Math.min(capture.height - 1, projected[1] * (capture.height - 1)),
      );
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, capture.width - 1);
      const y1 = Math.min(y0 + 1, capture.height - 1);
      const dx = sx - x0;
      const dy = sy - y0;
      const destination = (y * canvas.width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const top =
          input.data[(y0 * capture.width + x0) * 4 + channel] * (1 - dx) +
          input.data[(y0 * capture.width + x1) * 4 + channel] * dx;
        const bottom =
          input.data[(y1 * capture.width + x0) * 4 + channel] * (1 - dx) +
          input.data[(y1 * capture.width + x1) * 4 + channel] * dx;
        output.data[destination + channel] = top * (1 - dy) + bottom * dy;
      }
      output.data[destination + 3] = 255;
    }
  }
  context.putImageData(output, 0, 0);
  return canvas;
}

interface Region {
  left: number;
  top: number;
  right: number;
  bottom: number;
  size: number;
}

/**
 * Find enclosed light interiors of marker-drawn rectangles, including adjoining piano keys.
 * This bounded, setup-only detector intentionally returns [] when no credible shapes exist.
 */
export function recognizeControls(imageData: ImageData): PaperControl[] {
  if (
    imageData.width < 16 ||
    imageData.height < 16 ||
    imageData.data.length < imageData.width * imageData.height * 4
  )
    return [];
  const scale = Math.min(1, 512 / Math.max(imageData.width, imageData.height));
  const width = Math.max(1, Math.round(imageData.width * scale));
  const height = Math.max(1, Math.round(imageData.height * scale));
  const length = width * height;
  const gray = new Uint8Array(length);
  let total = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const source =
        (Math.min(imageData.height - 1, Math.floor(y / scale)) *
          imageData.width +
          Math.min(imageData.width - 1, Math.floor(x / scale))) *
        4;
      const luminance =
        imageData.data[source + 3] < 32
          ? 255
          : Math.round(
              imageData.data[source] * 0.299 +
                imageData.data[source + 1] * 0.587 +
                imageData.data[source + 2] * 0.114,
            );
      gray[y * width + x] = luminance;
      total += luminance;
    }
  }
  const threshold = Math.min(150, (total / length) * 0.72);
  const dark = new Uint8Array(length);
  let darkCount = 0;
  for (let i = 0; i < length; i++) {
    if (gray[i] < threshold) {
      dark[i] = 1;
      darkCount++;
    }
  }
  if (darkCount < length * 0.002 || darkCount > length * 0.6) return [];
  // A one-pixel expansion bridges small marker gaps without connecting distant controls.
  const blocked = dark.slice();
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (!dark[y * width + x]) continue;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) blocked[(y + dy) * width + x + dx] = 1;
    }
  }
  const visited = new Uint8Array(length);
  const queue = new Int32Array(length);
  const regions: Region[] = [];
  for (let start = 0; start < length; start++) {
    if (blocked[start] || visited[start]) continue;
    let head = 0;
    let tail = 1;
    queue[0] = start;
    visited[start] = 1;
    const region: Region = {
      left: width,
      top: height,
      right: 0,
      bottom: 0,
      size: 0,
    };
    let touchesEdge = false;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      region.left = Math.min(region.left, x);
      region.right = Math.max(region.right, x);
      region.top = Math.min(region.top, y);
      region.bottom = Math.max(region.bottom, y);
      region.size++;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1)
        touchesEdge = true;
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x < width - 1 ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y < height - 1 ? index + width : -1,
      ];
      for (const neighbor of neighbors) {
        if (neighbor < 0 || blocked[neighbor] || visited[neighbor]) continue;
        visited[neighbor] = 1;
        queue[tail++] = neighbor;
      }
    }
    const regionWidth = region.right - region.left + 1;
    const regionHeight = region.bottom - region.top + 1;
    if (
      !touchesEdge &&
      regionWidth >= width * 0.025 &&
      regionHeight >= height * 0.05 &&
      regionWidth <= width * 0.92 &&
      regionHeight <= height * 0.92 &&
      region.size >= length * 0.0025 &&
      region.size / (regionWidth * regionHeight) > 0.7
    )
      regions.push(region);
  }
  // A nearly complete sheet outline is not a control; ambiguous/noisy pages need manual tracing.
  const candidates = regions.filter(
    (region) =>
      (region.right - region.left) * (region.bottom - region.top) <
      length * 0.75,
  );
  if (!candidates.length || candidates.length > 32) return [];
  candidates.sort((a, b) =>
    Math.abs(a.top - b.top) < height * 0.08 ? a.left - b.left : a.top - b.top,
  );
  return candidates.map((region, index) => {
    const left = Math.max(0, region.left - 2) / width;
    const right = Math.min(width, region.right + 2) / width;
    const top = Math.max(0, region.top - 2) / height;
    const bottom = Math.min(height, region.bottom + 2) / height;
    const isKey = (bottom - top) * height > (right - left) * width * 1.25;
    const midi =
      NATURAL_NOTES[index % NATURAL_NOTES.length] +
      12 * Math.floor(index / NATURAL_NOTES.length);
    const polygon: Point[] = [
      [left, top],
      [right, top],
      [right, bottom],
      [left, bottom],
    ];
    return {
      id: `detected-${index + 1}`,
      kind: isKey ? "key" : "pad",
      name: isKey ? noteName(midi) : `Pad ${index + 1}`,
      polygon,
      action: { type: "note", midi },
      electrode: null,
    };
  });
}
