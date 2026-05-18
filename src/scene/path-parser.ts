import type { Bounds } from './scene-node.js';

/** A Path2D plus its axis-aligned bounding box in path-local coordinates. */
export interface PathGeometry {
  readonly path: Path2D;
  readonly bounds: Bounds;
  /** Total stroked length in user-space units. 0 when unknown. */
  readonly length: number;
  /** True when the path forms a closed loop (rect, circle, polygon, or
   *  `<path>` ending with Z). Closed contours need dash-array scaling to
   *  wrap cleanly across the closure seam. */
  readonly closed: boolean;
}

/**
 * Parses an SVG `d` attribute string into a Path2D + bounds.
 *
 * The browser's Path2D constructor handles the full SVG path spec natively;
 * bounds come from a shared hidden <svg>/<path> helper element via
 * `getBBox()` (the only reliable way to get bounds for an arbitrary
 * Path2D).
 */
export function parseSvgPath(d: string, warnings: string[]): PathGeometry | null {
  const trimmed = d.trim();
  if (!trimmed) return null;
  try {
    const m = getPathMetrics(trimmed);
    return {
      path: new Path2D(trimmed),
      bounds: m.bounds,
      length: m.length,
      closed: /[zZ]\s*$/.test(trimmed),
    };
  } catch (e) {
    warnings.push(`failed to parse <path d="...">: ${String(e)}`);
    return null;
  }
}

// ── Primitive shape helpers ───────────────────────────────────────────────────

export function makeRectPath(
  x: number, y: number, w: number, h: number,
  rx: number, ry: number,
): PathGeometry {
  if (w <= 0 || h <= 0) return emptyGeometry();
  if (rx === 0 && ry === 0) {
    return {
      path: new Path2D(`M${x},${y}h${w}v${h}h${-w}Z`),
      bounds: { x, y, width: w, height: h },
      length: 2 * (w + h),
      closed: true,
    };
  }
  // SVG spec: rx/ry are clamped to half the width/height respectively.
  const rxC = Math.min(rx, w / 2);
  const ryC = Math.min(ry, h / 2);
  const d =
    `M${x + rxC},${y}` +
    `H${x + w - rxC}` +
    `A${rxC},${ryC} 0 0 1 ${x + w},${y + ryC}` +
    `V${y + h - ryC}` +
    `A${rxC},${ryC} 0 0 1 ${x + w - rxC},${y + h}` +
    `H${x + rxC}` +
    `A${rxC},${ryC} 0 0 1 ${x},${y + h - ryC}` +
    `V${y + ryC}` +
    `A${rxC},${ryC} 0 0 1 ${x + rxC},${y}` +
    `Z`;
  // Approximate: 4 straight edges minus corner arcs + 4 quarter ellipse arcs.
  const arcLen = ellipsePerimeter(rxC, ryC);
  const length = 2 * (w - 2 * rxC) + 2 * (h - 2 * ryC) + arcLen;
  return {
    path: new Path2D(d),
    bounds: { x, y, width: w, height: h },
    length, closed: true,
  };
}

export function makeCirclePath(cx: number, cy: number, r: number): PathGeometry {
  if (r <= 0) return emptyGeometry();
  const path = new Path2D(
    `M${cx - r},${cy}` +
    `A${r},${r} 0 1,0 ${cx + r},${cy}` +
    `A${r},${r} 0 1,0 ${cx - r},${cy}`,
  );
  return {
    path,
    bounds: { x: cx - r, y: cy - r, width: r * 2, height: r * 2 },
    length: 2 * Math.PI * r,
    closed: true,
  };
}

export function makeEllipsePath(
  cx: number, cy: number, rx: number, ry: number,
): PathGeometry {
  if (rx <= 0 || ry <= 0) return emptyGeometry();
  const path = new Path2D(
    `M${cx - rx},${cy}` +
    `A${rx},${ry} 0 1,0 ${cx + rx},${cy}` +
    `A${rx},${ry} 0 1,0 ${cx - rx},${cy}`,
  );
  return {
    path,
    bounds: { x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 },
    length: ellipsePerimeter(rx, ry),
    closed: true,
  };
}

export function makeLinePath(
  x1: number, y1: number, x2: number, y2: number,
): PathGeometry {
  const path = new Path2D(`M${x1},${y1}L${x2},${y2}`);
  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
  return {
    path,
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    length: Math.hypot(x2 - x1, y2 - y1),
    closed: false,
  };
}

export function makePolyPath(pointsAttr: string, close: boolean): PathGeometry {
  const nums = parseNumberList(pointsAttr);
  if (nums.length < 4) return emptyGeometry();
  let d = `M${nums[0]},${nums[1]}`;
  let minX = nums[0]!, maxX = nums[0]!, minY = nums[1]!, maxY = nums[1]!;
  let length = 0;
  let prevX = nums[0]!, prevY = nums[1]!;
  for (let i = 2; i + 1 < nums.length; i += 2) {
    const px = nums[i]!, py = nums[i + 1]!;
    d += `L${px},${py}`;
    length += Math.hypot(px - prevX, py - prevY);
    prevX = px; prevY = py;
    if (px < minX) minX = px; if (px > maxX) maxX = px;
    if (py < minY) minY = py; if (py > maxY) maxY = py;
  }
  if (close) {
    d += 'Z';
    length += Math.hypot(nums[0]! - prevX, nums[1]! - prevY);
  }
  return {
    path: new Path2D(d),
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    length, closed: close,
  };
}

function emptyGeometry(): PathGeometry {
  return {
    path: new Path2D(),
    bounds: { x: 0, y: 0, width: 0, height: 0 },
    length: 0,
    closed: false,
  };
}

/** Ramanujan's second approximation; <0.04 % error for any aspect ratio. */
function ellipsePerimeter(rx: number, ry: number): number {
  if (rx <= 0 || ry <= 0) return 0;
  const h = Math.pow(rx - ry, 2) / Math.pow(rx + ry, 2);
  return Math.PI * (rx + ry) * (1 + 3 * h / (10 + Math.sqrt(4 - 3 * h)));
}

// ── Path bounds via hidden SVG helper ─────────────────────────────────────────

interface BoundsHelper {
  readonly svg: SVGSVGElement;
  readonly path: SVGPathElement;
}
let _boundsHelper: BoundsHelper | null = null;

function getPathMetrics(d: string): { bounds: Bounds; length: number } {
  const helper = boundsHelper();
  if (!helper) return { bounds: { x: 0, y: 0, width: 0, height: 0 }, length: 0 };
  helper.path.setAttribute('d', d);
  try {
    const b = helper.path.getBBox();
    let length = 0;
    try { length = helper.path.getTotalLength(); } catch { /* ignore */ }
    return {
      bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
      length,
    };
  } catch {
    return { bounds: { x: 0, y: 0, width: 0, height: 0 }, length: 0 };
  }
}

function boundsHelper(): BoundsHelper | null {
  if (_boundsHelper) return _boundsHelper;
  if (typeof document === 'undefined') return null;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg') as SVGSVGElement;
  const path = document.createElementNS(ns, 'path') as SVGPathElement;
  svg.appendChild(path);
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;left:-9999px;top:-9999px';
  document.body.appendChild(svg);
  _boundsHelper = { svg, path };
  return _boundsHelper;
}

// ── Number list parser ────────────────────────────────────────────────────────

const NUM_RE = /-?\d*\.?\d+(?:[eE][-+]?\d+)?/g;

export function parseNumberList(s: string): number[] {
  const out: number[] = [];
  let m: RegExpExecArray | null;
  NUM_RE.lastIndex = 0;
  while ((m = NUM_RE.exec(s)) !== null) {
    out.push(parseFloat(m[0]));
  }
  return out;
}
