import type { Point } from "../types";
import type { AiShape } from "../../server/identify";
import { pointInPolygon } from "./geometry";

/**
 * Exact shape outlines from the drawing itself.
 *
 * A drawn closed shape encloses a patch of paper that is cut off from the rest of the page by ink.
 * We find those enclosed patches (connected non-ink regions that don't touch the image border),
 * trace their boundaries, and use them as the controls' outlines, so a slanted key, a star or a
 * wobbly circle is exactly what was drawn. Gemini only says what each patch is and reads its label.
 */

export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * "Ink" per pixel (0–255) = 255 - max(r, g, b), minus the local paper background.
 * Graphite and black pen darken every channel; blue/red ruled lines keep one channel bright, so they
 * barely register. (Gray ruled lines do; mergeShapes guards against those.)
 */
export function inkMap({ width: w, height: h, data }: RGBAImage): Float32Array {
  const raw = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) raw[i] = 255 - Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  // Paper isn't pure white: subtract a coarse local background so shadows don't look like ink.
  const out = new Float32Array(w * h);
  const r = Math.max(4, Math.round(w / 64));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      // 3x3 blur for the stroke, sparse ring sample for the background.
      let ink = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) ink += raw[clampI(y + dy, h) * w + clampI(x + dx, w)];
      let bg = Infinity;
      for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) bg = Math.min(bg, raw[clampI(y + dy, h) * w + clampI(x + dx, w)]);
      out[y * w + x] = Math.max(0, ink / 9 - bg);
    }
  return out;
}
const clampI = (v: number, n: number) => (v < 0 ? 0 : v >= n ? n - 1 : v);

export interface Region {
  points: Point[]; // normalized outline, clockwise in image coords
  samples: Point[]; // normalized interior points, for matching against AI outlines
}

const INK = 26; // stroke threshold on the background-subtracted ink map (0–255)

export function findRegions(ink: Float32Array, w: number, h: number): Region[] {
  const close = Math.max(1, Math.round(w / 400)); // bridge pencil gaps up to ~2×close px
  const solid = dilate(dropSmallMarks(Uint8Array.from(ink, (v) => (v >= INK ? 1 : 0)), w, h, w * 0.05), w, h, close);
  const label = new Int32Array(w * h).fill(-1);
  const queue = new Int32Array(w * h);
  const out: Region[] = [];
  const minArea = 0.0008 * w * h, maxArea = 0.3 * w * h;
  let id = 0;
  for (let start = 0; start < w * h; start++) {
    if (solid[start] || label[start] !== -1) continue;
    // Flood one paper patch (4-connected).
    let head = 0, tail = 0, border = false;
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    queue[tail++] = start;
    label[start] = id;
    while (head < tail) {
      const i = queue[head++], x = i % w, y = (i / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const j of [i - 1, i + 1, i - w, i + w]) {
        if (j < 0 || j >= w * h || solid[j] || label[j] !== -1) continue;
        if ((j === i - 1 && x === 0) || (j === i + 1 && x === w - 1)) continue;
        label[j] = id;
        queue[tail++] = j;
      }
    }
    if (!border && tail >= minArea && tail <= maxArea) {
      // Re-grow the patch past the gap-bridging and half the stroke so its outline sits on the middle of the line.
      const grow = close + 2;
      const pad = grow + 2, bw = x1 - x0 + 1 + pad * 2, bh = y1 - y0 + 1 + pad * 2;
      let local = new Uint8Array(bw * bh);
      for (let k = 0; k < tail; k++) {
        const i = queue[k];
        local[(((i / w) | 0) - y0 + pad) * bw + (i % w) - x0 + pad] = 1;
      }
      local = dilate(local, bw, bh, grow);
      const boundary = trace(local, bw, bh);
      if (boundary.length >= 8) {
        const step = Math.max(1, Math.floor(tail / 120));
        const samples: Point[] = [];
        for (let k = 0; k < tail; k += step) samples.push([((queue[k] % w) + 0.5) / w, (((queue[k] / w) | 0) + 0.5) / h]);
        const poly = simplify(boundary.map(([x, y]) => [x + x0 - pad, y + y0 - pad] as Point), 64, 1.5);
        out.push({ points: poly.map(([x, y]) => [(x + 0.5) / w, (y + 0.5) / h] as Point), samples });
      }
    }
    id++;
  }
  return out;
}

/**
 * Erase ink blobs smaller than `size` px across (letters, note names, specks) so writing inside a
 * shape can't cut its outline in two. The AI has already read the writing.
 */
function dropSmallMarks(m: Uint8Array, w: number, h: number, size: number): Uint8Array {
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (!m[start] || seen[start]) continue;
    let head = 0, tail = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    queue[tail++] = start;
    seen[start] = 1;
    while (head < tail) {
      const i = queue[head++], x = i % w, y = (i / w) | 0;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy, j = yy * w + xx;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h || !m[j] || seen[j]) continue;
          seen[j] = 1;
          queue[tail++] = j;
        }
    }
    if (Math.max(x1 - x0, y1 - y0) < size) for (let k = 0; k < tail; k++) m[queue[k]] = 0;
  }
  return m;
}

function dilate(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  // Separable square dilation: rows then columns.
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let d = -r; d <= r && !v; d++) {
        const xx = x + d;
        if (xx >= 0 && xx < w) v = m[y * w + xx];
      }
      tmp[y * w + x] = v;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let d = -r; d <= r && !v; d++) {
        const yy = y + d;
        if (yy >= 0 && yy < h) v = tmp[yy * w + x];
      }
      out[y * w + x] = v;
    }
  return out;
}

/** Moore-neighbour trace of the outer boundary of the (single) blob in a mask. */
function trace(m: Uint8Array, w: number, h: number): Point[] {
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && m[y * w + x] === 1;
  let sx = -1, sy = -1;
  for (let i = 0; i < w * h && sx < 0; i++) if (m[i]) [sx, sy] = [i % w, (i / w) | 0];
  if (sx < 0) return [];
  const dirs: Point[] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const pts: Point[] = [[sx, sy]];
  let [x, y] = [sx, sy];
  let d = 0; // start = top-left-most pixel, as if we arrived moving east (clockwise trace)
  for (let guard = 0; guard < w * h * 2; guard++) {
    let moved = false;
    for (let k = 0; k < 8; k++) {
      const nd = (d + 5 + k) % 8; // Moore: start just past the backtrack direction
      const [dx, dy] = dirs[nd];
      if (at(x + dx, y + dy)) {
        [x, y, d] = [x + dx, y + dy, nd];
        moved = true;
        break;
      }
    }
    if (!moved || (x === sx && y === sy)) break;
    pts.push([x, y]);
  }
  return pts;
}

/** Douglas–Peucker on a closed outline, loosening until it has at most `max` points. */
export function simplify(pts: Point[], max: number, minEps = 0): Point[] {
  const dp = (a: number, b: number, eps: number, keep: Set<number>) => {
    const [ax, ay] = pts[a], [bx, by] = pts[b % pts.length];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let far = -1, fd = eps;
    for (let i = a + 1; i < b; i++) {
      const dist = Math.abs((pts[i][0] - ax) * (by - ay) - (pts[i][1] - ay) * (bx - ax)) / len;
      if (dist > fd) [far, fd] = [i, dist];
    }
    if (far < 0) return;
    keep.add(far);
    dp(a, far, eps, keep);
    dp(far, b, eps, keep);
  };
  // Split the loop at its two farthest-apart points so DP works on two open chains.
  let mid = 0, best = 0;
  for (let i = 0; i < pts.length; i++) {
    const dd = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (dd > best) [best, mid] = [dd, i];
  }
  // Start at ~0.2% of the outline's size so this works in pixels or normalized units.
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const size = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1;
  for (let eps = Math.max(minEps, size * 0.002); ; eps *= 1.4) {
    const keep = new Set([0, mid]);
    dp(0, mid, eps, keep);
    dp(mid, pts.length, eps, keep);
    if (keep.size <= max || eps > size) return [...keep].sort((a, b) => a - b).map((i) => pts[i]);
  }
}

/**
 * Give each traced patch the AI's type and label (the AI outline that overlaps it most). Patches the
 * AI didn't report are ignored (gaps between ruled lines, torn edges); AI shapes the drawing can't
 * confirm keep the AI's outline.
 * A label goes only to the patch that overlaps its AI shape most, so it isn't copied to neighbours.
 */
export function mergeShapes(ai: AiShape[], regions: Region[]): AiShape[] {
  const share = regions.map((r) => ai.map((s) => r.samples.filter((p) => pointInPolygon(p, s.points)).length / r.samples.length));
  // Each patch's AI shape: the one holding most of it (at least a quarter).
  const owner = share.map((row) => {
    let j = -1, bv = 0.25;
    row.forEach((v, k) => {
      if (v > bv) [j, bv] = [k, v];
    });
    return j;
  });
  // Writing that touches a shape's outline can cut it in two. Pieces of one labelled AI shape that are
  // each clearly smaller than it but together about its size are one shape: join them (convex hull).
  // Then sanity-check against the AI: gray ruled lines can slice a key into strips, so a shape's
  // patches must each be a real part of it and together cover at least half of it; otherwise the
  // AI's own outline is used.
  const parts = regions.map((r) => ({ ...r, area: polyArea(r.points) }));
  const merged: (Region & { area: number; j: number })[] = [];
  const rejected = new Set<number>();
  ai.forEach((s, j) => {
    let mine = parts.filter((_, i) => owner[i] === j).sort((p, q) => q.area - p.area);
    if (!mine.length) return;
    const aiArea = polyArea(s.points);
    // Only when the AI saw writing in it: that's what cuts a shape, and it keeps sloppy boxes over two keys from joining them.
    const fragments = mine.length > 1 && s.label.trim() !== "" && mine.every((p) => p.area < 0.85 * aiArea) && mine.reduce((t, p) => t + p.area, 0) < 1.3 * aiArea;
    if (fragments) {
      const points = hull(mine.flatMap((p) => p.points));
      mine = [{ points, samples: mine.flatMap((p) => p.samples), area: polyArea(points) }];
    }
    mine = mine.filter((p) => p.area >= 0.3 * aiArea);
    const grid = gridIn(s.points);
    const covered = grid.filter((g) => mine.some((p) => pointInPolygon(g, p.points))).length / Math.max(1, grid.length);
    if (!mine.length || covered < 0.5) rejected.add(j);
    else mine.forEach((p) => merged.push({ ...p, j }));
  });
  // The AI's label goes to the patch that covers its shape best, so it isn't copied to neighbours.
  const labelled = new Set<number>();
  const out: AiShape[] = [...merged]
    .sort((p, q) => q.area - p.area)
    .map((r) => {
      const first = !labelled.has(r.j);
      labelled.add(r.j);
      return { shape: ai[r.j].shape, points: r.points, label: first ? ai[r.j].label : "" };
    });
  // AI shapes the drawing couldn't confirm (faint or broken strokes, ruled lines): keep the AI outline,
  // unless that area is already taken by an accepted patch.
  ai.forEach((s, j) => {
    if (owner.includes(j) && !rejected.has(j)) return;
    const c = gridIn(s.points);
    const taken = c.filter((g) => merged.some((p) => pointInPolygon(g, p.points))).length / Math.max(1, c.length);
    if (taken < 0.3) out.push(s);
  });
  return out;
}

/** ~100 sample points spread over a polygon's inside. */
function gridIn(poly: Point[]): Point[] {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const out: Point[] = [];
  for (let i = 0; i < 12; i++)
    for (let k = 0; k < 12; k++) {
      const g: Point = [x0 + ((i + 0.5) / 12) * (x1 - x0), y0 + ((k + 0.5) / 12) * (y1 - y0)];
      if (pointInPolygon(g, poly)) out.push(g);
    }
  return out;
}

function polyArea(p: Point[]) {
  return Math.abs(p.reduce((s, [x, y], i) => s + x * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * y, 0)) / 2;
}

/** Convex hull (monotone chain), clockwise in image coordinates. */
function hull(points: Point[]): Point[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: Point[]) => {
    const h: Point[] = [];
    for (const q of list) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop();
      h.push(q);
    }
    h.pop();
    return h;
  };
  return [...half(p), ...half([...p].reverse())];
}
