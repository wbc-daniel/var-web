import { argbToCss } from '../loader/css-color.js';
import type {
  Bounds,
  LinearGradientPaint,
  Matrix2D,
  RadialGradientPaint,
  SvgPaint,
} from '../scene/scene-node.js';

/**
 * Resolves an SvgPaint to a value assignable to `ctx.fillStyle` / `strokeStyle`.
 * For solid colours this is a CSS rgba() string; for gradients it is a
 * CanvasGradient created on [ctx].
 *
 * `bounds` is the geometry's local-space bbox, used to map gradients in
 * `objectBoundingBox` mode. May be null when no geometry was registered.
 */
export function resolvePaint(
  ctx: CanvasRenderingContext2D,
  paint: SvgPaint,
  bounds: Bounds | null,
): string | CanvasGradient {
  switch (paint.kind) {
    case 'solid':
      return argbToCss(paint.argb);
    case 'linearGradient':
      return makeLinearGradient(ctx, paint, bounds);
    case 'radialGradient':
      return makeRadialGradient(ctx, paint, bounds);
  }
}

// ── Linear gradient ───────────────────────────────────────────────────────────

function makeLinearGradient(
  ctx: CanvasRenderingContext2D,
  g: LinearGradientPaint,
  bounds: Bounds | null,
): CanvasGradient {
  let x1 = g.x1, y1 = g.y1, x2 = g.x2, y2 = g.y2;
  if (g.objectBoundingBox && bounds) {
    x1 = bounds.x + x1 * bounds.width;
    y1 = bounds.y + y1 * bounds.height;
    x2 = bounds.x + x2 * bounds.width;
    y2 = bounds.y + y2 * bounds.height;
  }
  if (g.gradientTransform) {
    [x1, y1] = applyMatrix(g.gradientTransform, x1, y1);
    [x2, y2] = applyMatrix(g.gradientTransform, x2, y2);
  }

  const grad = ctx.createLinearGradient(x1, y1, x2, y2);
  addStops(grad, g.colors, g.stops);
  return grad;
}

// ── Radial gradient ───────────────────────────────────────────────────────────

function makeRadialGradient(
  ctx: CanvasRenderingContext2D,
  g: RadialGradientPaint,
  bounds: Bounds | null,
): CanvasGradient {
  let cx = g.cx, cy = g.cy, r = g.r;
  let fx = g.fx ?? cx;
  let fy = g.fy ?? cy;
  if (g.objectBoundingBox && bounds) {
    cx = bounds.x + cx * bounds.width;
    cy = bounds.y + cy * bounds.height;
    fx = bounds.x + fx * bounds.width;
    fy = bounds.y + fy * bounds.height;
    // Approximation: SVG spec uses bbox-diagonal-derived radius, but the
    // closer-to-browser approximation is max(w, h) * r — matches Flutter.
    r = Math.max(bounds.width, bounds.height) * r;
  }
  if (g.gradientTransform) {
    [cx, cy] = applyMatrix(g.gradientTransform, cx, cy);
    [fx, fy] = applyMatrix(g.gradientTransform, fx, fy);
  }

  const grad = ctx.createRadialGradient(fx, fy, 0, cx, cy, r);
  addStops(grad, g.colors, g.stops);
  return grad;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function addStops(
  grad: CanvasGradient,
  colors: readonly number[],
  stops: readonly number[],
): void {
  for (let i = 0; i < colors.length; i++) {
    const stop = stops[i] ?? (colors.length > 1 ? i / (colors.length - 1) : 0);
    grad.addColorStop(clamp01(stop), argbToCss(colors[i]!));
  }
}

function applyMatrix(m: Matrix2D, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
