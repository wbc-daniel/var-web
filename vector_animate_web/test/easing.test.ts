import { describe, expect, it } from 'vitest';
import {
  applyEasing,
  lerp,
  lerpAngleDeg,
  lerpNullable,
} from '../src/engine/easing.js';
import type { EasingCurve } from '../src/model/types.js';

const ALL_CURVES: EasingCurve[] = [
  'linear', 'ease-in', 'ease-out', 'ease-in-out', 'ease-in-out-back',
  'step', 'bounce-in', 'bounce-out', 'elastic-in', 'elastic-out',
];

describe('applyEasing', () => {
  it.each(ALL_CURVES)('"%s" maps t=0 to 0 and t=1 to 1', (curve) => {
    expect(applyEasing(curve, 0)).toBe(0);
    expect(applyEasing(curve, 1)).toBe(1);
  });

  it.each(ALL_CURVES)('"%s" clamps t outside [0,1]', (curve) => {
    expect(applyEasing(curve, -1)).toBe(0);
    expect(applyEasing(curve, 2)).toBe(1);
  });

  it('linear is the identity on [0,1]', () => {
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(applyEasing('linear', t)).toBe(t);
    }
  });

  it('ease-in cubes its input', () => {
    expect(applyEasing('ease-in', 0.5)).toBeCloseTo(0.125, 6);
    expect(applyEasing('ease-in', 0.25)).toBeCloseTo(0.015625, 6);
  });

  it('ease-out is 1 - (1-t)^3', () => {
    expect(applyEasing('ease-out', 0.5)).toBeCloseTo(0.875, 6);
    expect(applyEasing('ease-out', 0.25)).toBeCloseTo(0.578125, 6);
  });

  it('step jumps from 0 to 1 only at t=1', () => {
    expect(applyEasing('step', 0.0)).toBe(0);
    expect(applyEasing('step', 0.5)).toBe(0);
    expect(applyEasing('step', 0.999)).toBe(0);
    expect(applyEasing('step', 1.0)).toBe(1);
  });

  it('ease-in-out-back overshoots [0,1] mid-curve', () => {
    // c2 ≈ 2.59… → known overshoot below 0 around t≈0.15 and above 1 around t≈0.85
    expect(applyEasing('ease-in-out-back', 0.15)).toBeLessThan(0);
    expect(applyEasing('ease-in-out-back', 0.85)).toBeGreaterThan(1);
  });

  it('elastic-out and elastic-in oscillate around their endpoints', () => {
    // The exact values aren't important — we just want non-monotonic behaviour
    // mid-curve. Sample several points and verify both directions are visited.
    const samples = [0.1, 0.2, 0.3, 0.4, 0.6, 0.7, 0.8, 0.9].map(t => applyEasing('elastic-out', t));
    expect(samples.some(v => v > 1)).toBe(true);
    expect(samples.some(v => v < 1)).toBe(true);
  });
});

describe('lerp', () => {
  it('interpolates linearly', () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 1)).toBe(20);
    expect(lerp(10, 20, 0.5)).toBe(15);
    expect(lerp(-5, 5, 0.5)).toBe(0);
  });
});

describe('lerpAngleDeg', () => {
  it('takes the shortest path across the ±180° boundary', () => {
    // 170 → -170 should go through ±180, not through 0.
    expect(lerpAngleDeg(170, -170, 0.5)).toBeCloseTo(180, 6);
    // -170 → 170 should also go the short way (through 180).
    expect(lerpAngleDeg(-170, 170, 0.5)).toBeCloseTo(-180, 6);
  });

  it('is the identity for adjacent angles', () => {
    expect(lerpAngleDeg(0, 90, 0.5)).toBeCloseTo(45, 6);
    expect(lerpAngleDeg(0, 0, 0.5)).toBe(0);
  });
});

describe('lerpNullable', () => {
  it('returns null when both sides are null', () => {
    expect(lerpNullable(null, null, 0.5)).toBeNull();
  });

  it('returns the non-null side without lerping', () => {
    expect(lerpNullable(null, 5, 0.5)).toBe(5);
    expect(lerpNullable(3, null, 0.5)).toBe(3);
  });

  it('lerps when both sides are present', () => {
    expect(lerpNullable(10, 20, 0.5)).toBe(15);
  });
});
