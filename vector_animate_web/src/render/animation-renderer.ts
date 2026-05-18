import { argbToCss } from '../loader/css-color.js';
import { IDENTITY, multiplyMatrices, type Matrix2D, type SceneNode } from '../scene/scene-node.js';
import { applyBoxFit, type BoxFit } from './box-fit.js';
import { resolvePaint } from './paint.js';
import type { VectorAnimateController } from '../engine/controller.js';
import type {
  AnimatedElement,
  NodePos,
  ResolvedElement,
  VectorAnimation,
} from '../model/types.js';

export interface RendererOptions {
  /** Default 'contain'. */
  boxFit?: BoxFit;
  /**
   * Controls the warm-up paint cycle (one synchronous frame before the RAF
   * loop starts, so V8 JIT-compiles the hot paint path before it runs under
   * frame budget pressure).
   *
   * Precedence:
   *   - Explicit `true` / `false` → always wins.
   *   - Omitted → defers to the .var file's `runtimeHints.warmUp` flag
   *     (default `true` when no hints are present). This lets the designer's
   *     runtime-export modal disable warm-up for animations that bake enough
   *     work upstream to make it unnecessary.
   */
  warmUp?: boolean;
}

/**
 * Renders a [VectorAnimateController]'s current pose into an HTML <canvas>.
 *
 * Owns a `requestAnimationFrame` loop while [start]ed; each tick advances the
 * controller and repaints the canvas. Uses the canvas's CSS pixel size
 * (`clientWidth` / `clientHeight`) and scales the context by
 * `devicePixelRatio` for crisp rendering on retina displays. A
 * `ResizeObserver` keeps the bitmap size in sync with the CSS size.
 */
export class AnimationRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly controller: VectorAnimateController;
  boxFit: BoxFit;

  private _ctx: CanvasRenderingContext2D;
  private _dpr = 1;
  private _cssWidth = 0;
  private _cssHeight = 0;
  private _rafId: number | null = null;
  private _lastTickMs: number | null = null;
  private _resizeObserver: ResizeObserver | null = null;
  /** undefined = defer to the file's runtimeHints.warmUp on first start(). */
  private _warmUpOption: boolean | undefined;
  private _warmUpDone = false;

  constructor(
    canvas: HTMLCanvasElement,
    controller: VectorAnimateController,
    options: RendererOptions = {},
  ) {
    this.canvas = canvas;
    this.controller = controller;
    this.boxFit = options.boxFit ?? 'contain';
    this._warmUpOption = options.warmUp;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('AnimationRenderer: canvas.getContext("2d") returned null');
    this._ctx = ctx;
    this._syncCanvasSize();

    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => this._syncCanvasSize());
      this._resizeObserver.observe(canvas);
    }
  }

  /** Begins the RAF loop. No-op if already running. */
  start(): void {
    if (this._rafId !== null) return;
    if (!this._warmUpDone) {
      this._warmUpDone = true;
      // Explicit option wins; otherwise defer to the file's hint (default on).
      const hint = this.controller.animation.runtimeHints?.warmUp;
      const want = this._warmUpOption ?? hint ?? true;
      if (want) this._paint();
    }
    const tick = (now: number): void => {
      if (this._lastTickMs !== null) {
        let dt = now - this._lastTickMs;
        // Cap: a backgrounded tab can produce huge dt that fast-forwards hours.
        if (dt > 100) dt = 100;
        this.controller.advance(dt);
      }
      this._lastTickMs = now;
      this._paint();
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  /** Stops the RAF loop. The canvas keeps its last frame. */
  stop(): void {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._lastTickMs = null;
  }

  /** Forces a single repaint without advancing the controller. */
  paint(): void { this._paint(); }

  /** Stops the RAF loop and disconnects the ResizeObserver. */
  dispose(): void {
    this.stop();
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
  }

  // ── Sizing ──────────────────────────────────────────────────────────────────

  private _syncCanvasSize(): void {
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const cssW = this.canvas.clientWidth || this.canvas.width;
    const cssH = this.canvas.clientHeight || this.canvas.height;
    const bitmapW = Math.max(1, Math.round(cssW * dpr));
    const bitmapH = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== bitmapW)  this.canvas.width  = bitmapW;
    if (this.canvas.height !== bitmapH) this.canvas.height = bitmapH;
    this._dpr = dpr;
    this._cssWidth = cssW;
    this._cssHeight = cssH;
  }

  // ── Paint ───────────────────────────────────────────────────────────────────

  private _paint(): void {
    const ctx = this._ctx;
    const animation = this.controller.animation;
    const vp = animation.viewport;

    // Reset to bitmap-pixel space, then scale by DPR so 1 unit = 1 CSS pixel.
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);

    if (vp.backgroundArgb !== null) {
      ctx.fillStyle = argbToCss(vp.backgroundArgb);
      ctx.fillRect(0, 0, this._cssWidth, this._cssHeight);
    } else {
      ctx.clearRect(0, 0, this._cssWidth, this._cssHeight);
    }

    if (vp.width <= 0 || vp.height <= 0) return;

    ctx.save();
    applyBoxFit(ctx, this.boxFit, this._cssWidth, this._cssHeight, vp);

    // Clip to viewport rect (in viewport-local coords).
    ctx.beginPath();
    ctx.rect(vp.x, vp.y, vp.width, vp.height);
    ctx.clip();

    const fade = this.controller.transitionInFadeOpacity;
    const resolved = this.controller.resolveAll();
    const scope: PaintScope = { ctx, animation, resolved };

    if (fade < 1) {
      const prevAlpha = ctx.globalAlpha;
      ctx.globalAlpha = prevAlpha * fade;
      paintNode(animation.scene, scope);
      ctx.globalAlpha = prevAlpha;
    } else {
      paintNode(animation.scene, scope);
    }

    ctx.restore();
  }
}

// ── Paint pass ────────────────────────────────────────────────────────────────

interface PaintScope {
  readonly ctx: CanvasRenderingContext2D;
  readonly animation: VectorAnimation;
  readonly resolved: Map<string, ResolvedElement>;
}

function paintNode(node: SceneNode, scope: PaintScope): void {
  const { ctx, animation, resolved } = scope;

  // visible: false hides the entire subtree (matches typical SVG / CSS expectation).
  const el: AnimatedElement | undefined = node.id !== null
    ? animation.elements[node.id]
    : undefined;
  if (el && !el.visible) return;

  // Keyframe-driven hidden: skip entire subtree when hidden === true.
  const anim = node.id !== null ? resolved.get(node.id) : undefined;
  if (anim?.hidden === true) return;

  ctx.save();

  // 1. Clip mask — applied in the *parent* coord space, before this node's transforms.
  if (el?.clipMaskId) {
    const maskNode = animation.sceneIndex.get(el.clipMaskId);
    if (maskNode) {
      const maskPath = buildMaskPath(maskNode, resolved.get(el.clipMaskId));
      if (maskPath) ctx.clip(maskPath);
    }
  }

  // 2. Static clip-path — also applied in the *parent* coord space (SVG
  //    clipPathUnits="userSpaceOnUse" default: coordinates are defined in the
  //    referencing element's parent coordinate system, i.e. before this node's
  //    own transforms).  Must come before steps 3–4.
  if (node.clipPath) ctx.clip(node.clipPath);

  // 3. Animated transform (pivot-relative).
  if (anim) {
    ctx.translate(anim.pivotX + anim.x, anim.pivotY + anim.y);
    if (anim.rotation !== 0) ctx.rotate((anim.rotation * Math.PI) / 180);
    if (anim.scaleX !== 1 || anim.scaleY !== 1) ctx.scale(anim.scaleX, anim.scaleY);
    ctx.translate(-anim.pivotX, -anim.pivotY);
  }

  // 4. Static SVG transform.
  if (node.transform) {
    const m = node.transform;
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  }

  // 5. Effective opacity (animated × static).
  const effectiveOpacity = (anim?.opacity ?? 1) * node.opacity;
  if (effectiveOpacity <= 0) {
    ctx.restore();
    return;
  }
  const prevAlpha = ctx.globalAlpha;
  if (effectiveOpacity < 1) ctx.globalAlpha = prevAlpha * effectiveOpacity;

  // 6. Geometry.
  if (node.geometry) drawGeometry(node, anim, scope);

  // 7. Children — z-sorted only when at least one child has a non-null resolved zIndex.
  paintChildren(node.children, scope);

  if (effectiveOpacity < 1) ctx.globalAlpha = prevAlpha;
  ctx.restore();
}

function paintChildren(children: readonly SceneNode[], scope: PaintScope): void {
  if (children.length === 0) return;

  let needsSort = false;
  for (const c of children) {
    if (c.id !== null && (scope.resolved.get(c.id)?.zIndex ?? null) !== null) {
      needsSort = true;
      break;
    }
  }

  if (!needsSort) {
    for (const c of children) paintNode(c, scope);
    return;
  }

  const indexed: Array<[number, SceneNode]> = children.map((c, i) => {
    const z = c.id !== null ? (scope.resolved.get(c.id)?.zIndex ?? i) : i;
    return [z, c];
  });
  indexed.sort((a, b) => a[0] - b[0]);
  for (const [, c] of indexed) paintNode(c, scope);
}

function drawGeometry(
  node: SceneNode,
  anim: ResolvedElement | undefined,
  scope: PaintScope,
): void {
  const { ctx } = scope;
  // Geometry precedence:
  //   1. Animated nodePositions (per-frame path morphing) — overrides everything.
  //   2. Pre-tessellated polyline baked at export time (option 4) — bypasses
  //      Impeller/Skia curve tessellation on first paint.
  //   3. Static SVG-derived path.
  const el = node.id !== null ? scope.animation.elements[node.id] : undefined;
  const geom = (anim?.nodePositions && buildPath2DFromNodes(anim.nodePositions))
    ?? el?.polylinePath
    ?? node.geometry!;

  // Data-binding overrides replace the static paint with a solid colour.
  const fillSrc = anim?.fillOverride !== null && anim?.fillOverride !== undefined
    ? ({ kind: 'solid', argb: anim.fillOverride } as const)
    : node.fill;
  const strokeSrc = anim?.strokeOverride !== null && anim?.strokeOverride !== undefined
    ? ({ kind: 'solid', argb: anim.strokeOverride } as const)
    : node.stroke;

  if (fillSrc) {
    ctx.fillStyle = resolvePaint(ctx, fillSrc, node.geometryBounds);
    ctx.fill(geom);
  }
  if (strokeSrc && node.strokeWidth > 0) {
    ctx.strokeStyle = resolvePaint(ctx, strokeSrc, node.geometryBounds);
    ctx.lineWidth = node.strokeWidth;
    ctx.lineCap = node.strokeLinecap;
    ctx.lineJoin = node.strokeLinejoin;
    // When polylines are baked, use their length/closed flag for the seam-
    // scaling — the polyline is what's actually being stroked.
    const usingPolyline = el?.polylinePath != null && !anim?.nodePositions;
    const dashClosed = usingPolyline ? (el!.polylineClosed) : node.geometryClosed;
    const dashLength = usingPolyline ? (el!.polylineLength) : node.geometryLength;
    applyStrokeDash(ctx, node, anim, dashClosed, dashLength);
    ctx.stroke(geom);
  }
}

function applyStrokeDash(
  ctx: CanvasRenderingContext2D,
  node: SceneNode,
  anim: ResolvedElement | undefined,
  geomClosed: boolean,
  geomLength: number,
): void {
  if (node.strokeDashArray.length === 0) {
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    return;
  }
  const offset = anim?.strokeDashOffset ?? node.strokeDashOffset;
  // For closed paths, fit cycle * N to the contour length so the dash pattern
  // tiles cleanly across the closure seam — matches the designer's pathLength
  // trick. Without this, animating offset on a closed shape "moves past the
  // start" because the leftover partial cycle overflows the seam (Canvas2D's
  // setLineDash lays the pattern out linearly without wrap).
  if (geomClosed && geomLength > 0) {
    let rawCycle = 0;
    for (const v of node.strokeDashArray) rawCycle += v;
    if (rawCycle > 0) {
      const N = Math.max(1, Math.round(geomLength / rawCycle));
      const scale = geomLength / (N * rawCycle);
      const scaled = node.strokeDashArray.map(v => v * scale);
      ctx.setLineDash(scaled);
      ctx.lineDashOffset = offset * scale;
      return;
    }
  }
  ctx.setLineDash(node.strokeDashArray as number[]);
  ctx.lineDashOffset = offset;
}

// ── Mask path construction ────────────────────────────────────────────────────

/**
 * Builds the clip region for an element whose `clipMaskId` references
 * `maskNode`. Walks the entire mask subtree so masks rooted on a `<g>` (a
 * "group" animated element with no own geometry) accumulate the union of
 * their descendants' shapes, matching the authoring tool's expectation.
 *
 * Returns null when the subtree contributes no geometry — the caller treats
 * that as "no clip" rather than "clip everything out".
 */
function buildMaskPath(
  maskNode: SceneNode,
  anim: ResolvedElement | undefined,
): Path2D | null {
  const result = new Path2D();
  // Mask's animated transform is applied at the wrapper level; the wrapper's
  // own static transform is folded into the per-node walk below so we don't
  // double-apply it here.
  const root: Matrix2D = anim ? animTransformOf(anim) : IDENTITY;
  let added = 0;
  function walk(node: SceneNode, parentTransform: Matrix2D): void {
    const combined: Matrix2D = node.transform
      ? multiplyMatrices(parentTransform, node.transform)
      : parentTransform;
    if (node.geometry) {
      result.addPath(node.geometry, {
        a: combined[0], b: combined[1],
        c: combined[2], d: combined[3],
        e: combined[4], f: combined[5],
      });
      added++;
    }
    for (const child of node.children) walk(child, combined);
  }
  walk(maskNode, root);
  return added > 0 ? result : null;
}

/**
 * Builds a Path2D directly from animated path-node positions. Iteration order
 * of `nodes` defines the traversal — entries flagged `isMove` (or the very
 * first entry) start a new sub-path; otherwise we emit a line or cubic bezier
 * depending on whether either endpoint carries control points.
 *
 * Returns null when `nodes` is empty so the caller can fall back to the static
 * geometry without a guard at the call site.
 */
function buildPath2DFromNodes(
  nodes: ReadonlyMap<string, NodePos>,
): Path2D | null {
  if (nodes.size === 0) return null;
  const path = new Path2D();
  let prev: NodePos | null = null;
  let contourStart: NodePos | null = null;
  let first = true;
  for (const node of nodes.values()) {
    if (first || node.isMove) {
      path.moveTo(node.x, node.y);
      contourStart = node;
      prev = node;
      first = false;
      continue;
    }
    if (prev) {
      const cpOut = prev.cpOut;
      const cpIn  = node.cpIn;
      if (cpOut || cpIn) {
        path.bezierCurveTo(
          cpOut ? cpOut.x : prev.x, cpOut ? cpOut.y : prev.y,
          cpIn  ? cpIn.x  : node.x, cpIn  ? cpIn.y  : node.y,
          node.x, node.y,
        );
      } else {
        path.lineTo(node.x, node.y);
      }
    }
    if (node.close && contourStart) {
      // Mirrors editor's nodesToPathD: if either endpoint of the closing
      // segment carries a control point, emit it as a bezier so the curve
      // matches the original path's seam.
      const closeCpOut = node.cpOut;
      const closeCpIn  = contourStart.cpIn;
      if (closeCpOut || closeCpIn) {
        path.bezierCurveTo(
          closeCpOut ? closeCpOut.x : node.x,         closeCpOut ? closeCpOut.y : node.y,
          closeCpIn  ? closeCpIn.x  : contourStart.x, closeCpIn  ? closeCpIn.y  : contourStart.y,
          contourStart.x, contourStart.y,
        );
      }
      path.closePath();
      contourStart = null;
    }
    prev = node;
  }
  return path;
}

/** Builds the pivot-relative animated transform as a matrix. */
function animTransformOf(anim: ResolvedElement): Matrix2D {
  const cos = Math.cos((anim.rotation * Math.PI) / 180);
  const sin = Math.sin((anim.rotation * Math.PI) / 180);
  // T(pivotX+x, pivotY+y) × R × S × T(-pivotX, -pivotY)
  let m: Matrix2D = [1, 0, 0, 1, anim.pivotX + anim.x, anim.pivotY + anim.y];
  m = multiplyMatrices(m, [cos, sin, -sin, cos, 0, 0]);
  m = multiplyMatrices(m, [anim.scaleX, 0, 0, anim.scaleY, 0, 0]);
  m = multiplyMatrices(m, [1, 0, 0, 1, -anim.pivotX, -anim.pivotY]);
  return m;
}
