import type { Viewport } from '../model/types.js';

/** Mirrors Flutter's BoxFit. Default is `contain`. */
export type BoxFit =
  | 'contain'
  | 'cover'
  | 'fill'
  | 'fitWidth'
  | 'fitHeight'
  | 'scaleDown'
  | 'none';

/**
 * Applies a BoxFit transform to [ctx], mapping the SVG viewport into a target
 * rectangle of `(cssW, cssH)` CSS pixels. Caller must `save()` first; this
 * function does not touch save/restore state.
 */
export function applyBoxFit(
  ctx: CanvasRenderingContext2D,
  fit: BoxFit,
  cssW: number,
  cssH: number,
  vp: Viewport,
): void {
  if (vp.width <= 0 || vp.height <= 0) return;
  const sx = cssW / vp.width;
  const sy = cssH / vp.height;
  let scale: { x: number; y: number };
  let offset: { x: number; y: number };

  switch (fit) {
    case 'fill':
      scale = { x: sx, y: sy };
      offset = { x: 0, y: 0 };
      break;
    case 'cover': {
      const s = Math.max(sx, sy);
      scale = { x: s, y: s };
      offset = { x: (cssW - vp.width * s) / 2, y: (cssH - vp.height * s) / 2 };
      break;
    }
    case 'fitWidth':
      scale = { x: sx, y: sx };
      offset = { x: 0, y: (cssH - vp.height * sx) / 2 };
      break;
    case 'fitHeight':
      scale = { x: sy, y: sy };
      offset = { x: (cssW - vp.width * sy) / 2, y: 0 };
      break;
    case 'scaleDown': {
      const s = Math.min(1, Math.min(sx, sy));
      scale = { x: s, y: s };
      offset = { x: (cssW - vp.width * s) / 2, y: (cssH - vp.height * s) / 2 };
      break;
    }
    case 'none':
      scale = { x: 1, y: 1 };
      offset = { x: (cssW - vp.width) / 2, y: (cssH - vp.height) / 2 };
      break;
    case 'contain':
    default: {
      const s = Math.min(sx, sy);
      scale = { x: s, y: s };
      offset = { x: (cssW - vp.width * s) / 2, y: (cssH - vp.height * s) / 2 };
      break;
    }
  }

  ctx.translate(offset.x, offset.y);
  ctx.scale(scale.x, scale.y);
  ctx.translate(-vp.x, -vp.y);
}
