// ── 2D affine matrix ──────────────────────────────────────────────────────────

/**
 * 2D affine transform as the 6-element tuple [a, b, c, d, e, f], matching the
 * CSS/Canvas `transform(a,b,c,d,e,f)` and SVG `matrix(a,b,c,d,e,f)` convention:
 *
 *   | a  c  e |
 *   | b  d  f |
 *   | 0  0  1 |
 */
export type Matrix2D = [number, number, number, number, number, number];

export const IDENTITY: Matrix2D = [1, 0, 0, 1, 0, 0];

/** Returns true when m is (within floating-point tolerance) the identity. */
export function isIdentity(m: Matrix2D): boolean {
  return (
    Math.abs(m[0] - 1) < 1e-9 &&
    Math.abs(m[1]) < 1e-9 &&
    Math.abs(m[2]) < 1e-9 &&
    Math.abs(m[3] - 1) < 1e-9 &&
    Math.abs(m[4]) < 1e-9 &&
    Math.abs(m[5]) < 1e-9
  );
}

/** A × B — applies B first, then A. */
export function multiplyMatrices(A: Matrix2D, B: Matrix2D): Matrix2D {
  return [
    A[0] * B[0] + A[2] * B[1],
    A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3],
    A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4],
    A[1] * B[4] + A[3] * B[5] + A[5],
  ];
}

// ── Paint sources ─────────────────────────────────────────────────────────────

export type SvgPaint = SolidPaint | LinearGradientPaint | RadialGradientPaint;

export interface SolidPaint {
  readonly kind: 'solid';
  /** ARGB integer, e.g. 0xFF000000 for opaque black. */
  readonly argb: number;
}

export type SpreadMethod = 'pad' | 'reflect' | 'repeat';

export interface LinearGradientPaint {
  readonly kind: 'linearGradient';
  /** Gradient line start (in objectBoundingBox fractions or user-space). */
  readonly x1: number;
  readonly y1: number;
  /** Gradient line end. */
  readonly x2: number;
  readonly y2: number;
  /** ARGB integers, one per stop. */
  readonly colors: readonly number[];
  readonly stops: readonly number[];
  readonly spreadMethod: SpreadMethod;
  /** If true, coordinates are 0..1 fractions of the element's bounding box. */
  readonly objectBoundingBox: boolean;
  readonly gradientTransform: Matrix2D | null;
}

export interface RadialGradientPaint {
  readonly kind: 'radialGradient';
  /** Centre of the outermost circle. */
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  /** Focal point. null = same as (cx, cy). */
  readonly fx: number | null;
  readonly fy: number | null;
  readonly colors: readonly number[];
  readonly stops: readonly number[];
  readonly spreadMethod: SpreadMethod;
  readonly objectBoundingBox: boolean;
  readonly gradientTransform: Matrix2D | null;
}

// ── Bounds ────────────────────────────────────────────────────────────────────

/** Axis-aligned bounding box in user-space SVG coordinates. */
export interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// ── Scene node ────────────────────────────────────────────────────────────────

export interface SceneNode {
  /** SVG id attribute — used to look up the matching AnimatedElement. */
  readonly id: string | null;
  readonly tagName: string;
  /** null for container-only nodes (<svg>, <g>). */
  readonly geometry: Path2D | null;
  /** Pre-computed bounds for the geometry. null when geometry is null. */
  readonly geometryBounds: Bounds | null;
  /** Total stroked length of the geometry in user-space units. 0 when not
   *  computable (e.g. headless test environment without a DOM). Used by the
   *  renderer to scale the dash array on closed paths so the dash pattern
   *  tiles cleanly across the closure seam. */
  readonly geometryLength: number;
  /** True when the geometry is a closed loop (rect, circle, ellipse,
   *  polygon, or `<path>` ending in Z). */
  readonly geometryClosed: boolean;
  /** Resolved through SVG inheritance. null = no fill. */
  readonly fill: SvgPaint | null;
  /** Resolved through SVG inheritance. null = no stroke. */
  readonly stroke: SvgPaint | null;
  readonly strokeWidth: number;
  readonly strokeLinecap: 'butt' | 'round' | 'square';
  readonly strokeLinejoin: 'miter' | 'round' | 'bevel';
  /**
   * SVG `stroke-dasharray` parsed into a number list. Empty = solid stroke.
   * Combined with `strokeLinecap === 'round'`, an array like `[0, 12]`
   * produces a dotted line of round dots.
   */
  readonly strokeDashArray: readonly number[];
  /**
   * Static `stroke-dashoffset` from the SVG attribute. Used when no animated
   * value is supplied. Defaults to 0.
   */
  readonly strokeDashOffset: number;
  /** Static SVG transform attribute, if any. */
  readonly transform: Matrix2D | null;
  /** Static per-element opacity (not the animated value). */
  readonly opacity: number;
  /** clip-path="url(#id)" resolved to a flat Path2D, if any. */
  readonly clipPath: Path2D | null;
  readonly children: readonly SceneNode[];
}
