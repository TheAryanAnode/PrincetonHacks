import type { Corners, PaperControl, Point } from "../types";

const EPSILON = 1e-9;

/** A row-major 3×3 projective transform. Point coordinates may use any consistent units. */
export function computeHomography(from: Point[], to: Point[]): number[] {
  if (
    from.length !== 4 ||
    to.length !== 4 ||
    [...from, ...to].some(
      (point) =>
        point.length !== 2 || point.some((value) => !Number.isFinite(value)),
    )
  ) {
    throw new Error(
      "A homography needs four finite source and destination points.",
    );
  }
  const equations: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i];
    const [u, v] = to[i];
    equations.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    equations.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Partial pivoting avoids unstable division when an edge lies on an axis.
  for (let column = 0; column < 8; column++) {
    let pivot = column;
    for (let row = column + 1; row < 8; row++) {
      if (Math.abs(equations[row][column]) > Math.abs(equations[pivot][column]))
        pivot = row;
    }
    if (Math.abs(equations[pivot][column]) < EPSILON)
      throw new Error("Paper corners are degenerate.");
    [equations[column], equations[pivot]] = [
      equations[pivot],
      equations[column],
    ];
    const divisor = equations[column][column];
    for (let j = column; j <= 8; j++) equations[column][j] /= divisor;
    for (let row = 0; row < 8; row++) {
      if (row === column) continue;
      const factor = equations[row][column];
      for (let j = column; j <= 8; j++)
        equations[row][j] -= factor * equations[column][j];
    }
  }
  return [...equations.map((row) => row[8]), 1];
}

export function transformPoint(matrix: number[], [x, y]: Point): Point {
  const denominator = matrix[6] * x + matrix[7] * y + matrix[8];
  if (Math.abs(denominator) < EPSILON) return [Number.NaN, Number.NaN];
  return [
    (matrix[0] * x + matrix[1] * y + matrix[2]) / denominator,
    (matrix[3] * x + matrix[4] * y + matrix[5]) / denominator,
  ];
}

export function invertHomography(matrix: number[]): number[] {
  if (matrix.length !== 9 || matrix.some((value) => !Number.isFinite(value)))
    throw new Error("Expected a finite 3×3 transform.");
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const cofactors = [
    e * i - f * h,
    c * h - b * i,
    b * f - c * e,
    f * g - d * i,
    a * i - c * g,
    c * d - a * f,
    d * h - e * g,
    b * g - a * h,
    a * e - b * d,
  ];
  const determinant = a * cofactors[0] + b * cofactors[3] + c * cofactors[6];
  if (Math.abs(determinant) < EPSILON)
    throw new Error("Paper transform cannot be inverted.");
  return cofactors.map((value) => value / determinant);
}

/** Set transform-origin: 0 0; compute the input matrix in the element's pixel units. */
export function homographyToCss(matrix: number[]): string {
  const [a, b, c, d, e, f, g, h, i] = matrix;
  return `matrix3d(${[a, d, 0, g, b, e, 0, h, 0, 0, 1, 0, c, f, 0, i].join(",")})`;
}

function cross(a: Point, b: Point, c: Point): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(point: Point, a: Point, b: Point): boolean {
  return (
    Math.abs(cross(a, b, point)) < EPSILON &&
    point[0] >= Math.min(a[0], b[0]) - EPSILON &&
    point[0] <= Math.max(a[0], b[0]) + EPSILON &&
    point[1] >= Math.min(a[1], b[1]) - EPSILON &&
    point[1] <= Math.max(a[1], b[1]) + EPSILON
  );
}

function contains(
  point: Point,
  polygon: Point[],
  includeBoundary: boolean,
): boolean {
  if (polygon.length < 3 || !point.every(Number.isFinite)) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j];
    const b = polygon[i];
    if (onSegment(point, a, b)) return includeBoundary;
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}

/** Boundary points count as hits, so strokes are touchable too. */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  return contains(point, polygon, true);
}

export function validateCorners(corners: Corners): boolean {
  if (
    corners.length !== 4 ||
    corners.some(
      (point) =>
        point.length !== 2 ||
        point.some(
          (value) => !Number.isFinite(value) || value < 0 || value > 1,
        ),
    )
  )
    return false;
  let twiceArea = 0;
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const c = corners[(i + 2) % 4];
    // In image coordinates TL→TR→BR→BL has positive turns.
    if (cross(a, b, c) <= 0.0001 || Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.02)
      return false;
    twiceArea += a[0] * b[1] - a[1] * b[0];
  }
  return twiceArea >= 0.01;
}

/** Editable controls are convex, nondegenerate polygons inside the page. */
export function validateControlPolygon(polygon: Point[]): boolean {
  if (
    polygon.length < 3 ||
    polygon.length > 16 ||
    polygon.some(
      (p) =>
        !Array.isArray(p) ||
        p.length !== 2 ||
        p.some((v) => !Number.isFinite(v) || v < 0 || v > 1),
    )
  )
    return false;
  let direction = 0,
    area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length],
      c = polygon[(i + 2) % polygon.length];
    const turn = cross(a, b, c);
    if (Math.abs(turn) < 1e-7) return false;
    if (direction && Math.sign(turn) !== direction) return false;
    direction = Math.sign(turn);
    area += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(area) >= 0.0002;
}

function polygonsOverlap(a: Point[], b: Point[]): boolean {
  if (a.length < 3 || b.length < 3) return false;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      const aa = a[i];
      const ab = a[(i + 1) % a.length];
      const ba = b[j];
      const bb = b[(j + 1) % b.length];
      const first = cross(aa, ab, ba) * cross(aa, ab, bb);
      const second = cross(ba, bb, aa) * cross(ba, bb, ab);
      if (first < -EPSILON * EPSILON && second < -EPSILON * EPSILON)
        return true;
    }
  }
  for (const [source, target] of [
    [a, b],
    [b, a],
  ]) {
    let signedArea = 0;
    for (let i = 0; i < source.length; i++)
      signedArea +=
        source[i][0] * source[(i + 1) % source.length][1] -
        source[i][1] * source[(i + 1) % source.length][0];
    for (let i = 0; i < source.length; i++) {
      const p = source[i];
      const q = source[(i + 1) % source.length];
      if (contains(p, target, false)) return true;
      const midpoint: Point = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      if (contains(midpoint, target, false)) return true;
      // Coincident outlines have no strictly interior vertex; sample just inside an edge.
      const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (length > EPSILON) {
        const offset = (Math.sign(signedArea) * 1e-6) / length;
        const inset: Point = [
          midpoint[0] - (q[1] - p[1]) * offset,
          midpoint[1] + (q[0] - p[0]) * offset,
        ];
        if (contains(inset, source, false) && contains(inset, target, false))
          return true;
      }
    }
  }
  return false;
}

/** IDs involved in a positive-area overlap; adjacent keys sharing an edge are allowed. */
export function controlsOverlap(controls: PaperControl[]): string[] {
  const overlapping = new Set<string>();
  for (let i = 0; i < controls.length; i++) {
    for (let j = i + 1; j < controls.length; j++) {
      if (polygonsOverlap(controls[i].polygon, controls[j].polygon)) {
        overlapping.add(controls[i].id);
        overlapping.add(controls[j].id);
      }
    }
  }
  return [...overlapping];
}
