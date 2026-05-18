import { applyEasing, lerp, lerpAngleDeg, lerpNullable } from './easing.js';
import type {
  AnimatedElement,
  Keyframe,
  NodePos,
  ResolvedElement,
} from '../model/types.js';

// ── Resolved element factories ────────────────────────────────────────────────

/** Static identity pose — used when an element has no keyframes in a state. */
export function identityResolved(el: AnimatedElement): ResolvedElement {
  return {
    x: 0, y: 0, rotation: 0,
    scaleX: 1, scaleY: 1,
    opacity: 1,
    zIndex: null, pathProgress: null,
    pivotX: el.pivotX, pivotY: el.pivotY,
    fillOverride: null, strokeOverride: null,
    strokeDashOffset: null,
    hidden: null,
    nodePositions: null,
  };
}

/** Pose that exactly matches a single keyframe's values. */
export function resolvedFromKeyframe(kf: Keyframe, el: AnimatedElement): ResolvedElement {
  return {
    x: kf.x, y: kf.y, rotation: kf.rotation,
    scaleX: kf.scaleX, scaleY: kf.scaleY,
    opacity: kf.opacity,
    zIndex: kf.zIndex, pathProgress: kf.pathProgress,
    pivotX: el.pivotX, pivotY: el.pivotY,
    fillOverride: null, strokeOverride: null,
    strokeDashOffset: kf.strokeDashOffset,
    hidden: kf.hidden ?? null,
    nodePositions: kf.nodePositions,
  };
}

// ── Public resolution entry point ─────────────────────────────────────────────

/**
 * Resolves [el]'s animated values at [localTimeMs] within [stateName].
 *
 * When any keyframe carries a `props` declaration, per-channel interpolation
 * is used: each property finds its own bracketing keyframes that declare it.
 * Legacy keyframes (props == null) declare all channels, preserving
 * backwards-compatible behaviour.
 */
export function resolveElement(
  el: AnimatedElement,
  stateName: string,
  localTimeMs: number,
): ResolvedElement {
  const anim = el.animations[stateName];
  if (!anim || anim.keyframes.length === 0) return identityResolved(el);
  const kfs = anim.keyframes;
  if (kfs.length === 1) return resolvedFromKeyframe(kfs[0]!, el);

  // Fast path: no keyframe uses selective props — single binary search covers
  // all channels simultaneously.
  const hasSelectiveProps = kfs.some(k => k.props !== null);
  if (!hasSelectiveProps) {
    if (localTimeMs <= kfs[0]!.time) return resolvedFromKeyframe(kfs[0]!, el);
    if (localTimeMs >= kfs[kfs.length - 1]!.time) return resolvedFromKeyframe(kfs[kfs.length - 1]!, el);
    return resolveAllChannels(kfs, localTimeMs, el);
  }

  return resolvePerChannel(kfs, localTimeMs, el);
}

// ── Fast path: legacy "all channels" keyframes ────────────────────────────────

function resolveAllChannels(
  kfs: readonly Keyframe[],
  t: number,
  el: AnimatedElement,
): ResolvedElement {
  let lo = 0;
  let hi = kfs.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (kfs[mid]!.time <= t) lo = mid;
    else hi = mid;
  }
  const a = kfs[lo]!;
  const b = kfs[hi]!;
  const span = b.time - a.time;
  const frac = span <= 0 ? 1 : (t - a.time) / span;
  const eased = applyEasing(b.curve, frac);

  // Step-hold for hidden: last non-null value at or before t.
  let hidden: boolean | null = null;
  for (const kf of kfs) {
    if (kf.hidden == null) continue;
    if (kf.time <= t) hidden = kf.hidden;
    else break;
  }

  return {
    x:            lerp(a.x, b.x, eased),
    y:            lerp(a.y, b.y, eased),
    // Linear (not shortest-arc) lerp within a state — matches the editor and
    // lets users get full revolutions by typing rotation: 720. Cross-state
    // blending in `blendResolved` still uses shortest-arc.
    rotation:     lerp(a.rotation, b.rotation, eased),
    scaleX:       lerp(a.scaleX, b.scaleX, eased),
    scaleY:       lerp(a.scaleY, b.scaleY, eased),
    opacity:      lerp(a.opacity, b.opacity, eased),
    zIndex:       lerpNullable(a.zIndex, b.zIndex, eased),
    pathProgress: lerpNullable(a.pathProgress, b.pathProgress, eased),
    pivotX:       el.pivotX,
    pivotY:       el.pivotY,
    fillOverride: null,
    strokeOverride: null,
    strokeDashOffset: lerpNullable(a.strokeDashOffset, b.strokeDashOffset, eased),
    hidden,
    nodePositions: resolveNodePositions(kfs, t),
  };
}

// ── Slow path: selective per-channel interpolation ────────────────────────────

function resolvePerChannel(
  kfs: readonly Keyframe[],
  t: number,
  el: AnimatedElement,
): ResolvedElement {
  return {
    x:        resolveChannel(kfs, t, 'x',        kf => kf.x,        0, false),
    y:        resolveChannel(kfs, t, 'y',        kf => kf.y,        0, false),
    rotation: resolveChannel(kfs, t, 'rotation', kf => kf.rotation, 0, false),
    scaleX:   resolveChannel(kfs, t, 'scaleX',   kf => kf.scaleX,   1, false),
    scaleY:   resolveChannel(kfs, t, 'scaleY',   kf => kf.scaleY,   1, false),
    opacity:  resolveChannel(kfs, t, 'opacity',  kf => kf.opacity,  1, false),
    zIndex:       resolveNullableChannel(kfs, t, 'zIndex',       kf => kf.zIndex),
    pathProgress: resolveNullableChannel(kfs, t, 'pathProgress', kf => kf.pathProgress),
    strokeDashOffset:
      resolveNullableChannel(kfs, t, 'strokeDashOffset', kf => kf.strokeDashOffset),
    hidden: resolveStepBoolChannel(kfs, t, 'hidden', kf => kf.hidden),
    pivotX: el.pivotX,
    pivotY: el.pivotY,
    fillOverride: null,
    strokeOverride: null,
    nodePositions: resolveNodePositions(kfs, t),
  };
}

/** Find bracketing kfs that drive `nodePositions` and interpolate per anchor.
 *  Mirrors the editor's `interpolateNodePositions`: lerp x/y/cpIn/cpOut, hold
 *  isMove/close from the lo node. Iteration order of the result follows the
 *  lo keyframe's Map order (keys absent from lo fall through to hi's order). */
function resolveNodePositions(
  kfs: readonly Keyframe[],
  t: number,
): ReadonlyMap<string, NodePos> | null {
  let lo: Keyframe | null = null;
  let hi: Keyframe | null = null;
  for (const kf of kfs) {
    if (!kf.nodePositions) continue;
    if (kf.time <= t) lo = kf;
    else { hi = kf; break; }
  }
  if (!lo && !hi) return null;
  if (!lo) return hi!.nodePositions;
  if (!hi) return lo.nodePositions;
  const span = hi.time - lo.time;
  const frac = span <= 0 ? 1 : (t - lo.time) / span;
  const eased = applyEasing(hi.curve, frac);
  return lerpNodePositions(lo.nodePositions!, hi.nodePositions!, eased);
}

function lerpNodePositions(
  a: ReadonlyMap<string, NodePos>,
  b: ReadonlyMap<string, NodePos>,
  t: number,
): ReadonlyMap<string, NodePos> {
  const out = new Map<string, NodePos>();
  // Walk `a` first so the result preserves the original path traversal order
  // for shared nodes; nodes only present in `b` are appended afterwards.
  for (const [key, na] of a) {
    const nb = b.get(key);
    out.set(key, nb ? blendNode(na, nb, t) : na);
  }
  for (const [key, nb] of b) {
    if (!out.has(key)) out.set(key, nb);
  }
  return out;
}

function blendNode(a: NodePos, b: NodePos, t: number): NodePos {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    cpIn:  blendCp(a.cpIn,  b.cpIn,  t),
    cpOut: blendCp(a.cpOut, b.cpOut, t),
    isMove: a.isMove,
    close:  a.close,
  };
}

function blendCp(
  a: { readonly x: number; readonly y: number } | null,
  b: { readonly x: number; readonly y: number } | null,
  t: number,
): { readonly x: number; readonly y: number } | null {
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

/** Step-hold resolver for boolean channels (e.g. hidden). Returns the last
 *  non-null value declared by a keyframe at or before t, or null if none. */
function resolveStepBoolChannel(
  kfs: readonly Keyframe[],
  t: number,
  ch: string,
  get: (kf: Keyframe) => boolean | null,
): boolean | null {
  let val: boolean | null = null;
  for (const kf of kfs) {
    if (!declaresChannel(kf, ch)) continue;
    if (get(kf) == null) continue;
    if (kf.time <= t) val = get(kf);
    else break;
  }
  return val;
}

function declaresChannel(kf: Keyframe, ch: string): boolean {
  return kf.props === null || kf.props.has(ch);
}

/** Resolves one required channel by finding the bracketing keyframes that declare it. */
function resolveChannel(
  kfs: readonly Keyframe[],
  t: number,
  ch: string,
  get: (kf: Keyframe) => number,
  identity: number,
  isAngle: boolean,
): number {
  let lo = -1;
  for (let i = kfs.length - 1; i >= 0; i--) {
    if (kfs[i]!.time <= t && declaresChannel(kfs[i]!, ch)) { lo = i; break; }
  }
  let hi = -1;
  for (let i = 0; i < kfs.length; i++) {
    if (kfs[i]!.time > t && declaresChannel(kfs[i]!, ch)) { hi = i; break; }
  }

  if (lo === -1 && hi === -1) return identity;
  if (lo === -1) return get(kfs[hi]!);
  if (hi === -1) return get(kfs[lo]!);

  const a = kfs[lo]!;
  const b = kfs[hi]!;
  const span = b.time - a.time;
  const frac = span <= 0 ? 1 : (t - a.time) / span;
  const eased = applyEasing(b.curve, frac);
  return isAngle ? lerpAngleDeg(get(a), get(b), eased) : lerp(get(a), get(b), eased);
}

/** Resolves one optional channel (zIndex, pathProgress) — null values skipped. */
function resolveNullableChannel(
  kfs: readonly Keyframe[],
  t: number,
  ch: string,
  get: (kf: Keyframe) => number | null,
): number | null {
  let lo = -1;
  for (let i = kfs.length - 1; i >= 0; i--) {
    if (kfs[i]!.time <= t && declaresChannel(kfs[i]!, ch) && get(kfs[i]!) !== null) {
      lo = i; break;
    }
  }
  let hi = -1;
  for (let i = 0; i < kfs.length; i++) {
    if (kfs[i]!.time > t && declaresChannel(kfs[i]!, ch) && get(kfs[i]!) !== null) {
      hi = i; break;
    }
  }

  if (lo === -1 && hi === -1) return null;
  if (lo === -1) return get(kfs[hi]!);
  if (hi === -1) return get(kfs[lo]!);

  const a = kfs[lo]!;
  const b = kfs[hi]!;
  const span = b.time - a.time;
  const frac = span <= 0 ? 1 : (t - a.time) / span;
  const eased = applyEasing(b.curve, frac);
  return lerp(get(a)!, get(b)!, eased);
}

// ── State transition blending ─────────────────────────────────────────────────

/** Blends from → to by t in [0, 1]. Used during state transitions. */
export function blendResolved(
  from: ResolvedElement,
  to: ResolvedElement,
  t: number,
): ResolvedElement {
  return {
    x:            lerp(from.x, to.x, t),
    y:            lerp(from.y, to.y, t),
    rotation:     lerpAngleDeg(from.rotation, to.rotation, t),
    scaleX:       lerp(from.scaleX, to.scaleX, t),
    scaleY:       lerp(from.scaleY, to.scaleY, t),
    opacity:      lerp(from.opacity, to.opacity, t),
    zIndex:       lerpNullable(from.zIndex, to.zIndex, t),
    pathProgress: lerpNullable(from.pathProgress, to.pathProgress, t),
    pivotX:       to.pivotX,
    pivotY:       to.pivotY,
    fillOverride:   to.fillOverride,
    strokeOverride: to.strokeOverride,
    strokeDashOffset: lerpNullable(from.strokeDashOffset, to.strokeDashOffset, t),
    hidden: to.hidden ?? from.hidden,
    // Cross-state path-node morphing isn't currently supported — hold whichever
    // side has resolved nodes (prefer the destination once we're past t=0).
    nodePositions: t > 0 ? (to.nodePositions ?? from.nodePositions) : (from.nodePositions ?? to.nodePositions),
  };
}
