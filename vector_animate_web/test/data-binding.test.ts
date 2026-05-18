import { describe, expect, it } from 'vitest';
import {
  argbLerp,
  isColorProperty,
  mapColor,
  mapScalar,
} from '../src/engine/data-binding.js';
import type { DataBinding } from '../src/model/types.js';

function binding(overrides: Partial<DataBinding> = {}): DataBinding {
  return {
    id: 'b', property: 'x', dataKey: 'k',
    settlingMs: 0, curve: 'linear',
    inMin: 0, inMax: 1, outMin: 0, outMax: 100,
    colorMinArgb: null, colorMaxArgb: null,
    ...overrides,
  };
}

describe('isColorProperty', () => {
  it('returns true for fill and stroke', () => {
    expect(isColorProperty('fill')).toBe(true);
    expect(isColorProperty('stroke')).toBe(true);
  });

  it('returns false for transform/scalar properties', () => {
    for (const p of ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'opacity'] as const) {
      expect(isColorProperty(p)).toBe(false);
    }
  });
});

describe('mapScalar', () => {
  it('maps endpoints exactly', () => {
    const b = binding({ inMin: 0, inMax: 10, outMin: 100, outMax: 200 });
    expect(mapScalar(b, 0)).toBe(100);
    expect(mapScalar(b, 10)).toBe(200);
  });

  it('linearly interpolates inside the input range', () => {
    const b = binding({ inMin: 0, inMax: 10, outMin: 100, outMax: 200 });
    expect(mapScalar(b, 5)).toBe(150);
    expect(mapScalar(b, 2.5)).toBe(125);
  });

  it('clamps inputs outside the range', () => {
    const b = binding({ inMin: 0, inMax: 10, outMin: 100, outMax: 200 });
    expect(mapScalar(b, -5)).toBe(100);
    expect(mapScalar(b, 100)).toBe(200);
  });

  it('returns outMin when the input span is zero', () => {
    const b = binding({ inMin: 5, inMax: 5, outMin: 7, outMax: 9 });
    expect(mapScalar(b, 5)).toBe(7);
  });
});

describe('mapColor', () => {
  it('maps endpoints to the configured ARGB colors', () => {
    const b = binding({
      property: 'fill',
      inMin: 0, inMax: 1,
      colorMinArgb: 0xFFFF0000, colorMaxArgb: 0xFF0000FF,
    });
    expect(mapColor(b, 0) >>> 0).toBe(0xFFFF0000);
    expect(mapColor(b, 1) >>> 0).toBe(0xFF0000FF);
  });

  it('falls back to black/white when colorMin/Max are null', () => {
    const b = binding({ property: 'fill', inMin: 0, inMax: 1 });
    expect(mapColor(b, 0) >>> 0).toBe(0xFF000000);
    expect(mapColor(b, 1) >>> 0).toBe(0xFFFFFFFF);
  });

  it('clamps inputs outside the range', () => {
    const b = binding({
      property: 'fill', inMin: 0, inMax: 1,
      colorMinArgb: 0xFF000000, colorMaxArgb: 0xFFFFFFFF,
    });
    expect(mapColor(b, -1) >>> 0).toBe(0xFF000000);
    expect(mapColor(b, 5)  >>> 0).toBe(0xFFFFFFFF);
  });
});

describe('argbLerp', () => {
  it('returns endpoints exactly at t=0 and t=1', () => {
    expect(argbLerp(0xFFFF0000, 0xFF0000FF, 0) >>> 0).toBe(0xFFFF0000);
    expect(argbLerp(0xFFFF0000, 0xFF0000FF, 1) >>> 0).toBe(0xFF0000FF);
  });

  it('blends component-wise at midpoint (incl. alpha)', () => {
    // (a=0x00, r=0xFF, g=0x00, b=0x00) → (a=0xFF, r=0x00, g=0x00, b=0xFF)
    // midpoint: a=0x80 (128), r=0x80 (~127.5→128), g=0x00, b=0x80 (128)
    const v = argbLerp(0x00FF0000, 0xFF0000FF, 0.5) >>> 0;
    expect((v >>> 24) & 0xFF).toBe(128);
    expect((v >>> 16) & 0xFF).toBe(128); // 255*0.5 rounds to 128
    expect((v >>> 8)  & 0xFF).toBe(0);
    expect( v         & 0xFF).toBe(128);
  });
});
