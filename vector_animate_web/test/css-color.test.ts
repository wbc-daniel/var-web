import { describe, expect, it } from 'vitest';
import { argbToCss, parseCssColorToArgb } from '../src/loader/css-color.js';

describe('parseCssColorToArgb', () => {
  it('parses 3-character hex by doubling each digit', () => {
    expect(parseCssColorToArgb('#fff') >>> 0).toBe(0xFFFFFFFF);
    expect(parseCssColorToArgb('#000') >>> 0).toBe(0xFF000000);
    expect(parseCssColorToArgb('#abc') >>> 0).toBe(0xFFAABBCC);
  });

  it('parses 6-character hex with implied opaque alpha', () => {
    expect(parseCssColorToArgb('#FF0000') >>> 0).toBe(0xFFFF0000);
    expect(parseCssColorToArgb('#00ff00') >>> 0).toBe(0xFF00FF00);
  });

  it('parses 8-character hex with explicit (CSS-trailing) alpha', () => {
    // CSS stores alpha last; ARGB stores it first.
    // #RRGGBBAA = #FF000080 → ARGB 0x80_FF_00_00
    expect(parseCssColorToArgb('#FF000080') >>> 0).toBe(0x80FF0000);
  });

  it('returns null for none/transparent/empty/whitespace', () => {
    expect(parseCssColorToArgb('none')).toBeNull();
    expect(parseCssColorToArgb('transparent')).toBeNull();
    expect(parseCssColorToArgb('')).toBeNull();
    expect(parseCssColorToArgb('   ')).toBeNull();
    expect(parseCssColorToArgb(null)).toBeNull();
    expect(parseCssColorToArgb(undefined)).toBeNull();
  });

  it('returns null for unrecognised values', () => {
    expect(parseCssColorToArgb('#zz')).toBeNull();
    expect(parseCssColorToArgb('garbage')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(parseCssColorToArgb('#FF0000') >>> 0).toBe(parseCssColorToArgb('#ff0000') >>> 0);
  });
});

describe('argbToCss', () => {
  it('emits rgba() with normalised alpha', () => {
    expect(argbToCss(0xFFFF0000)).toBe('rgba(255,0,0,1.000)');
    expect(argbToCss(0x80FF0000)).toBe('rgba(255,0,0,0.502)');
    expect(argbToCss(0x00000000)).toBe('rgba(0,0,0,0.000)');
  });

  it('round-trips with parseCssColorToArgb for opaque hex', () => {
    const inputs = [0xFFFF0000, 0xFF00FF00, 0xFF0000FF, 0xFF123456];
    for (const argb of inputs) {
      // parse(argbToCss(x)) won't equal x because argbToCss emits rgba() and the
      // parser only handles hex. So we test the other direction: parse a hex
      // string and verify the resulting argb matches expectation.
      const hex = `#${argb.toString(16).padStart(8, '0').slice(2)}`;
      expect(parseCssColorToArgb(hex) >>> 0).toBe(argb);
    }
  });
});
