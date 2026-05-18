/**
 * Parses a CSS color string into a 32-bit ARGB integer.
 *
 * Supported formats: #RGB, #RRGGBB, #RRGGBBAA.
 * Returns null for null, empty, "none", "transparent", or unrecognised values.
 */
export function parseCssColorToArgb(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = raw.trim().toLowerCase();
  if (s === '' || s === 'none' || s === 'transparent') return null;

  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0]! + hex[0]!, 16);
      const g = parseInt(hex[1]! + hex[1]!, 16);
      const b = parseInt(hex[2]! + hex[2]!, 16);
      return (0xff << 24 | r << 16 | g << 8 | b) >>> 0;
    }
    if (hex.length === 6) {
      return (0xff << 24 | parseInt(hex, 16)) >>> 0;
    }
    if (hex.length === 8) {
      // #RRGGBBAA — note: CSS stores alpha last, ARGB stores it first
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = parseInt(hex.slice(6, 8), 16);
      return (a << 24 | r << 16 | g << 8 | b) >>> 0;
    }
  }

  return null;
}

/** Converts an ARGB integer to a CSS rgba() string. */
export function argbToCss(argb: number): string {
  const a = (argb >>> 24) & 0xff;
  const r = (argb >>> 16) & 0xff;
  const g = (argb >>> 8) & 0xff;
  const b = argb & 0xff;
  return `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
}
