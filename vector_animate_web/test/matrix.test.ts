import { describe, expect, it } from 'vitest';
import {
  IDENTITY,
  isIdentity,
  multiplyMatrices,
  type Matrix2D,
} from '../src/scene/scene-node.js';

describe('IDENTITY', () => {
  it('is [1,0,0,1,0,0]', () => {
    expect(IDENTITY).toEqual([1, 0, 0, 1, 0, 0]);
  });
});

describe('isIdentity', () => {
  it('returns true for the identity', () => {
    expect(isIdentity([1, 0, 0, 1, 0, 0])).toBe(true);
  });

  it('returns true within floating-point tolerance', () => {
    expect(isIdentity([1 + 1e-12, 0, 0, 1, 0, 0])).toBe(true);
  });

  it('returns false for any non-identity', () => {
    expect(isIdentity([2, 0, 0, 1, 0, 0])).toBe(false);
    expect(isIdentity([1, 0, 0, 1, 1, 0])).toBe(false);
    expect(isIdentity([1, 0.1, 0, 1, 0, 0])).toBe(false);
  });
});

describe('multiplyMatrices', () => {
  it('I × M = M', () => {
    const m: Matrix2D = [2, 0, 0, 3, 7, 11];
    expect(multiplyMatrices(IDENTITY, m)).toEqual(m);
  });

  it('M × I = M', () => {
    const m: Matrix2D = [2, 0, 0, 3, 7, 11];
    expect(multiplyMatrices(m, IDENTITY)).toEqual(m);
  });

  it('composes two translations into their sum', () => {
    const t1: Matrix2D = [1, 0, 0, 1, 10, 20];
    const t2: Matrix2D = [1, 0, 0, 1, 30, 40];
    expect(multiplyMatrices(t1, t2)).toEqual([1, 0, 0, 1, 40, 60]);
  });

  it('composes two scales into their product', () => {
    const s1: Matrix2D = [2, 0, 0, 3, 0, 0];
    const s2: Matrix2D = [4, 0, 0, 5, 0, 0];
    expect(multiplyMatrices(s1, s2)).toEqual([8, 0, 0, 15, 0, 0]);
  });

  it('translate × scale: applies scale first, then translate (right-to-left)', () => {
    const t: Matrix2D = [1, 0, 0, 1, 10, 20];
    const s: Matrix2D = [2, 0, 0, 3, 0, 0];
    // (T × S) applied to (x, y) = T(S(x, y)) = T(2x, 3y) = (2x + 10, 3y + 20)
    const m = multiplyMatrices(t, s);
    expect(m).toEqual([2, 0, 0, 3, 10, 20]);
  });
});
