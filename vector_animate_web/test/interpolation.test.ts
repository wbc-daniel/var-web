import { describe, expect, it } from 'vitest';
import { resolveElement } from '../src/engine/property-resolver.js';
import type {
  AnimatedElement,
  EasingCurve,
  Keyframe,
} from '../src/model/types.js';

function kf(overrides: Partial<Keyframe> = {}): Keyframe {
  return {
    id: 'k', time: 0, x: 0, y: 0, rotation: 0,
    scaleX: 1, scaleY: 1, opacity: 1,
    zIndex: null, pathProgress: null,
    curve: 'linear' as EasingCurve, props: null,
    ...overrides,
  };
}

function el(keyframes: Keyframe[], pivotX = 0, pivotY = 0): AnimatedElement {
  return {
    id: 'e', tagName: 'rect', pivotX, pivotY, visible: true,
    animations: { idle: { keyframes } },
    dataBindings: [], clipMaskId: null,
  };
}

describe('resolveElement — empty cases', () => {
  it('returns identity when the state has no animation', () => {
    const e = el([]);
    const r = resolveElement(e, 'idle', 0);
    expect(r.x).toBe(0);
    expect(r.scaleX).toBe(1);
    expect(r.opacity).toBe(1);
  });

  it('returns identity when the state name is unknown', () => {
    const e = el([kf({ x: 100 })]);
    const r = resolveElement(e, 'missing', 0);
    expect(r.x).toBe(0);
  });
});

describe('resolveElement — single keyframe', () => {
  it('returns the lone keyframe verbatim', () => {
    const e = el([kf({ x: 42, y: 7, rotation: 30 })]);
    const r = resolveElement(e, 'idle', 999);
    expect(r.x).toBe(42);
    expect(r.y).toBe(7);
    expect(r.rotation).toBe(30);
  });
});

describe('resolveElement — fast path (legacy keyframes)', () => {
  const e = el([
    kf({ id: 'a', time: 0,    x: 0,   y: 0 }),
    kf({ id: 'b', time: 1000, x: 100, y: 50 }),
  ]);

  it('returns first keyframe when t <= start', () => {
    expect(resolveElement(e, 'idle', -50).x).toBe(0);
    expect(resolveElement(e, 'idle', 0).x).toBe(0);
  });

  it('returns last keyframe when t >= end', () => {
    expect(resolveElement(e, 'idle', 1000).x).toBe(100);
    expect(resolveElement(e, 'idle', 5000).x).toBe(100);
  });

  it('linearly interpolates between keyframes', () => {
    const r = resolveElement(e, 'idle', 500);
    expect(r.x).toBeCloseTo(50, 6);
    expect(r.y).toBeCloseTo(25, 6);
  });

  it('honours the entry curve of the later keyframe', () => {
    const easeIn = el([
      kf({ id: 'a', time: 0,    x: 0,   curve: 'linear' }),
      kf({ id: 'b', time: 1000, x: 100, curve: 'ease-in' }),
    ]);
    // ease-in at t=0.5 returns 0.125 → 12.5
    expect(resolveElement(easeIn, 'idle', 500).x).toBeCloseTo(12.5, 6);
  });
});

describe('resolveElement — per-channel narrowing (slow path)', () => {
  it('only the keyframe declaring a channel drives that channel', () => {
    const e = el([
      kf({ id: 'a', time: 0,    x: 0,   y: 0,   props: new Set(['x', 'y']) }),
      kf({ id: 'b', time: 500,  x: 50,            props: new Set(['x']) }),
      kf({ id: 'c', time: 1000, x: 100, y: 200, props: new Set(['x', 'y']) }),
    ]);
    // At t=500: x is exactly the b keyframe's value (50); y interpolates a→c (so 100).
    const r = resolveElement(e, 'idle', 500);
    expect(r.x).toBeCloseTo(50, 6);
    expect(r.y).toBeCloseTo(100, 6);
  });

  it('mixing legacy + selective keyframes still resolves declared channels correctly', () => {
    const e = el([
      kf({ id: 'a', time: 0,    x: 0, props: null }),  // legacy: declares all
      kf({ id: 'b', time: 1000, x: 100, props: new Set(['x']) }),
    ]);
    expect(resolveElement(e, 'idle', 500).x).toBeCloseTo(50, 6);
  });
});

describe('resolveElement — pivot propagation', () => {
  it('copies element pivot into the resolved pose', () => {
    const e = el([kf({ x: 0 })], 12, 34);
    const r = resolveElement(e, 'idle', 0);
    expect(r.pivotX).toBe(12);
    expect(r.pivotY).toBe(34);
  });
});
