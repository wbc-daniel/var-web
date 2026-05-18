import type { BoundProperty, DataBinding } from '../model/types.js';

/** True for `fill` and `stroke` (color-typed bindings); false for scalars. */
export function isColorProperty(p: BoundProperty): boolean {
  return p === 'fill' || p === 'stroke';
}

/**
 * Maps an external scalar value through a binding's clamped linear mapping.
 *
 *   raw → clamp((raw - inMin) / (inMax - inMin), 0, 1) → outMin..outMax
 */
export function mapScalar(b: DataBinding, raw: number): number {
  const span = b.inMax - b.inMin;
  if (span === 0) return b.outMin;
  let t = (raw - b.inMin) / span;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  return b.outMin + (b.outMax - b.outMin) * t;
}

/**
 * Maps an external scalar value through a colour binding's ARGB lerp.
 * Null endpoints fall back to opaque black / opaque white.
 */
export function mapColor(b: DataBinding, raw: number): number {
  const span = b.inMax - b.inMin;
  const a = b.colorMinArgb ?? 0xFF000000;
  const z = b.colorMaxArgb ?? 0xFFFFFFFF;
  if (span === 0) return a;
  let t = (raw - b.inMin) / span;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  return argbLerp(a, z, t);
}

/** Component-wise lerp of two ARGB integers (alpha included). */
export function argbLerp(a: number, b: number, t: number): number {
  const a1 = (a >>> 24) & 0xFF;
  const a2 = (b >>> 24) & 0xFF;
  const r1 = (a >>> 16) & 0xFF;
  const r2 = (b >>> 16) & 0xFF;
  const g1 = (a >>> 8) & 0xFF;
  const g2 = (b >>> 8) & 0xFF;
  const b1 = a & 0xFF;
  const b2 = b & 0xFF;
  const aa = Math.round(a1 + (a2 - a1) * t);
  const rr = Math.round(r1 + (r2 - r1) * t);
  const gg = Math.round(g1 + (g2 - g1) * t);
  const bb = Math.round(b1 + (b2 - b1) * t);
  return ((aa << 24) | (rr << 16) | (gg << 8) | bb) >>> 0;
}
