import type { EasingCurve } from '../model/types.js';

/**
 * Applies a curve to normalised progress t in [0, 1].
 *
 * Curves match the JS authoring tool's interpolation.js. Input is clamped at
 * the boundaries; output may overshoot [0, 1] for back/bounce/elastic curves
 * by design — that's what produces the visual overshoot.
 */
export function applyEasing(curve: EasingCurve, t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  switch (curve) {
    case 'linear':
      return t;
    case 'ease-in':
      return t * t * t;
    case 'ease-out': {
      const u = 1 - t;
      return 1 - u * u * u;
    }
    case 'ease-in-out':
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case 'ease-in-out-back': {
      const c1 = 1.70158;
      const c2 = c1 * 1.525;
      return t < 0.5
        ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
        : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
    }
    case 'step':
      return t < 1 ? 0 : 1;
    case 'bounce-out':
      return bounceOut(t);
    case 'bounce-in':
      return 1 - bounceOut(1 - t);
    case 'elastic-out': {
      const c4 = (2 * Math.PI) / 3;
      return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    }
    case 'elastic-in': {
      const c4 = (2 * Math.PI) / 3;
      return -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4);
    }
  }
}

function bounceOut(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) {
    return n1 * t * t;
  } else if (t < 2 / d1) {
    const u = t - 1.5 / d1;
    return n1 * u * u + 0.75;
  } else if (t < 2.5 / d1) {
    const u = t - 2.25 / d1;
    return n1 * u * u + 0.9375;
  } else {
    const u = t - 2.625 / d1;
    return n1 * u * u + 0.984375;
  }
}

// ── Interpolation primitives ─────────────────────────────────────────────────

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Shortest-path linear interpolation of angles in degrees. Prevents the
 * long-way-around behaviour when crossing the ±180° boundary.
 */
export function lerpAngleDeg(a: number, b: number, t: number): number {
  const delta = (((b - a) % 360) + 540) % 360 - 180;
  return a + delta * t;
}

/**
 * Lerps two nullable channel values. If either side is null, the non-null
 * value is returned (no fade in/out). If both are null, returns null.
 */
export function lerpNullable(a: number | null, b: number | null, t: number): number | null {
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;
  return lerp(a, b, t);
}
