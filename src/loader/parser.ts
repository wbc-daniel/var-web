import { parseCssColorToArgb } from './css-color.js';
import { parseSvg } from '../scene/svg-parser.js';
import type {
  AnimatedElement,
  BoundProperty,
  DataBinding,
  EasingCurve,
  ElementAnimation,
  ElementTransitionOverride,
  Keyframe,
  NodePos,
  RuntimeHints,
  StateConfig,
  StateTransition,
  TransitionDefaults,
  TransitionInConfig,
  VectorAnimation,
  Viewport,
} from '../model/types.js';

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Parses a decoded .var.json object into a VectorAnimation.
 * Unknown keys are silently ignored.
 */
export function parseVarJson(raw: unknown): VectorAnimation {
  if (typeof raw === 'string') raw = JSON.parse(raw) as unknown;
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('expected a JSON object');
  }
  const json = raw as Record<string, unknown>;
  const warnings: string[] = [];

  const svgRaw = str(json['svgRaw']) ?? '';
  if (!svgRaw) warnings.push('missing or empty svgRaw');

  const states = strArray(json['states']);
  const defaultState = str(json['defaultState']) ?? states[0] ?? '';

  const stateConfigs: Record<string, StateConfig> = {};
  const rawConfigs = json['stateConfigs'];
  if (isObj(rawConfigs)) {
    for (const [k, v] of Object.entries(rawConfigs)) {
      if (isObj(v)) stateConfigs[k] = parseStateConfig(v);
    }
  }

  const defaultTransition = parseDefaultTransition(json['defaultTransition']);

  const stateTransitions: StateTransition[] = [];
  const rawTransitions = json['stateTransitions'];
  if (Array.isArray(rawTransitions)) {
    for (const t of rawTransitions) {
      if (!isObj(t)) continue;
      const from = str(t['from']);
      const to = str(t['to']);
      if (!from || !to) {
        warnings.push('stateTransition missing from/to; skipped');
        continue;
      }
      const overrides: Record<string, ElementTransitionOverride> = {};
      const rawEls = t['elements'];
      if (isObj(rawEls)) {
        for (const [k, v] of Object.entries(rawEls)) {
          if (isObj(v)) {
            overrides[k] = {
              delay:    num(v['delay']) ?? 0,
              duration: num(v['duration']) ?? null,
              curve:    parseEasingCurve(v['curve']) ?? null,
            };
          }
        }
      }
      stateTransitions.push({
        from,
        to,
        duration: num(t['duration']) ?? defaultTransition.duration,
        curve:    parseEasingCurve(t['curve']) ?? 'ease-in-out',
        elements: overrides,
      });
    }
  }

  const elements: Record<string, AnimatedElement> = {};
  const rawElements = json['elements'];
  if (isObj(rawElements)) {
    for (const [k, v] of Object.entries(rawElements)) {
      if (isObj(v)) elements[k] = parseElement(k, v, warnings);
    }
  }

  const elementOrder = strArray(json['elementOrder']);

  const svgResult = svgRaw ? parseSvg(svgRaw) : null;
  if (svgResult) warnings.push(...svgResult.warnings);

  // Stub scene used when svgRaw is missing. Phase 2 fills it for valid files.
  const scene = svgResult?.root ?? {
    id: null, tagName: 'svg', geometry: null, geometryBounds: null,
    geometryLength: 0, geometryClosed: false,
    fill: null, stroke: null,
    strokeWidth: 1, strokeLinecap: 'butt', strokeLinejoin: 'miter',
    strokeDashArray: [], strokeDashOffset: 0,
    transform: null, opacity: 1, clipPath: null, children: [],
  };

  return {
    name:              str(json['name']) ?? '',
    fps:               Math.round(num(json['fps']) ?? 60),
    svgRaw,
    viewport:          parseViewport(json['viewport'], warnings),
    states,
    defaultState,
    stateConfigs,
    stateTransitions,
    defaultTransition,
    elements,
    elementOrder:      elementOrder.length > 0 ? elementOrder : Object.keys(elements),
    runtimeHints:      parseRuntimeHints(json['runtimeHints']),
    scene,
    sceneIndex:        svgResult?.sceneIndex ?? new Map(),
    warnings,
  };
}

function parseRuntimeHints(raw: unknown): RuntimeHints | null {
  if (!isObj(raw)) return null;
  return {
    warmUp:               bool(raw['warmUp'])               ?? true,
    preSampledKeyframes:  bool(raw['preSampledKeyframes'])  ?? false,
    sampleRate:           num(raw['sampleRate'])            ?? null,
    preTessellated:       bool(raw['preTessellated'])       ?? false,
    tessellationFlatness: num(raw['tessellationFlatness'])  ?? null,
  };
}

// ── Viewport ──────────────────────────────────────────────────────────────────

function parseViewport(raw: unknown, warnings: string[]): Viewport {
  if (!isObj(raw)) {
    warnings.push('missing viewport; using defaults');
    return { x: 0, y: 0, width: 0, height: 0, backgroundArgb: null };
  }
  return {
    x:              num(raw['x'])      ?? 0,
    y:              num(raw['y'])      ?? 0,
    width:          num(raw['width'])  ?? 0,
    height:         num(raw['height']) ?? 0,
    backgroundArgb: parseCssColorToArgb(str(raw['background'])),
  };
}

// ── State config ──────────────────────────────────────────────────────────────

function parseStateConfig(v: Record<string, unknown>): StateConfig {
  const duration  = num(v['duration'])  ?? 2000;
  const windowIn  = num(v['windowIn'])  ?? 0;
  const windowOut = num(v['windowOut']) ?? duration;
  return {
    duration,
    windowIn,
    windowOut,
    transitionIn: parseTransitionIn(v['transitionIn']),
  };
}

function parseTransitionIn(raw: unknown): TransitionInConfig {
  if (!isObj(raw)) return { type: 'animate', duration: 300 };
  return {
    type:     str(raw['type']) === 'fade' ? 'fade' : 'animate',
    duration: num(raw['duration']) ?? 300,
  };
}

function parseDefaultTransition(raw: unknown): TransitionDefaults {
  if (!isObj(raw)) return { duration: 300, curve: 'ease-in-out' };
  return {
    duration: num(raw['duration']) ?? 300,
    curve:    parseEasingCurve(raw['curve']) ?? 'ease-in-out',
  };
}

// ── Animated element ──────────────────────────────────────────────────────────

function parseElement(
  id: string,
  raw: Record<string, unknown>,
  warnings: string[],
): AnimatedElement {
  const animations: Record<string, ElementAnimation> = {};
  const rawAnims = raw['animations'];
  if (isObj(rawAnims)) {
    for (const [stateName, v] of Object.entries(rawAnims)) {
      if (!isObj(v)) continue;
      const rawKfs = v['keyframes'];
      if (!Array.isArray(rawKfs)) continue;
      const kfs: Keyframe[] = [];
      for (let i = 0; i < rawKfs.length; i++) {
        const kf = rawKfs[i];
        if (!isObj(kf)) continue;
        let props: ReadonlySet<string> | null = null;
        const rawProps = kf['props'];
        if (Array.isArray(rawProps)) {
          props = new Set(rawProps.filter((p): p is string => typeof p === 'string'));
        }
        kfs.push({
          id:           str(kf['id'])       ?? `${id}-${stateName}-${i}`,
          time:         num(kf['time'])      ?? 0,
          x:            num(kf['x'])         ?? 0,
          y:            num(kf['y'])         ?? 0,
          rotation:     num(kf['rotation'])  ?? 0,
          scaleX:       num(kf['scaleX'])    ?? 1,
          scaleY:       num(kf['scaleY'])    ?? 1,
          opacity:      num(kf['opacity'])   ?? 1,
          zIndex:       num(kf['zIndex'])    ?? null,
          pathProgress: num(kf['pathProgress']) ?? null,
          strokeDashOffset: num(kf['strokeDashOffset']) ?? null,
          hidden:       bool(kf['hidden'])  ?? null,
          nodePositions: parseNodePositions(kf['nodePositions']),
          curve:        parseEasingCurve(kf['curve']) ?? 'linear',
          props,
        });
      }
      kfs.sort((a, b) => a.time - b.time);
      animations[stateName] = { keyframes: kfs };
    }
  }

  const dataBindings: DataBinding[] = [];
  const rawBindings = raw['dataBindings'];
  if (Array.isArray(rawBindings)) {
    for (const b of rawBindings) {
      if (!isObj(b)) continue;
      const binding = parseBinding(id, b, warnings);
      if (binding) dataBindings.push(binding);
    }
  }

  const poly = parsePolylines(raw['polylines']);

  return {
    id,
    tagName:      str(raw['tagName']) ?? str(raw['type']) ?? '',
    pivotX:       num(raw['pivotX']) ?? 0,
    pivotY:       num(raw['pivotY']) ?? 0,
    visible:      raw['visible'] !== false,
    animations,
    dataBindings,
    clipMaskId:   str(raw['clipMaskId']) ?? null,
    polylinePath:  poly.path,
    polylineLength: poly.length,
    polylineClosed: poly.closed,
  };
}

interface ParsedPolylines {
  path: Path2D | null;
  length: number;
  closed: boolean;
}

function parsePolylines(raw: unknown): ParsedPolylines {
  if (!Array.isArray(raw) || raw.length === 0 || typeof Path2D === 'undefined') {
    return { path: null, length: 0, closed: false };
  }
  const path = new Path2D();
  let totalLength = 0;
  let anyClosed = false;
  for (const c of raw) {
    if (!isObj(c)) continue;
    const points = c['points'];
    if (!Array.isArray(points) || points.length < 4) continue;
    const closed = bool(c['closed']) ?? false;
    if (closed) anyClosed = true;
    let px = num(points[0]) ?? 0;
    let py = num(points[1]) ?? 0;
    path.moveTo(px, py);
    for (let i = 2; i < points.length - 1; i += 2) {
      const x = num(points[i]) ?? 0;
      const y = num(points[i + 1]) ?? 0;
      path.lineTo(x, y);
      totalLength += Math.hypot(x - px, y - py);
      px = x; py = y;
    }
    if (closed) path.closePath();
  }
  return { path, length: totalLength, closed: anyClosed };
}

function parseBinding(
  elementId: string,
  raw: Record<string, unknown>,
  warnings: string[],
): DataBinding | null {
  const propertyRaw = str(raw['property']);
  const dataKey     = str(raw['dataKey']);
  if (!propertyRaw || !dataKey) {
    warnings.push(`data binding on "${elementId}" missing property or dataKey; skipped`);
    return null;
  }
  if (!isBoundProperty(propertyRaw)) {
    warnings.push(`data binding on "${elementId}" has unknown property "${propertyRaw}"; skipped`);
    return null;
  }
  return {
    id:           str(raw['id'])      ?? `db_${elementId}_${propertyRaw}`,
    property:     propertyRaw,
    dataKey,
    settlingMs:   num(raw['settlingMs']) ?? 300,
    curve:        parseEasingCurve(raw['curve']) ?? 'linear',
    inMin:        num(raw['inMin'])  ?? 0,
    inMax:        num(raw['inMax'])  ?? 1,
    outMin:       num(raw['outMin']) ?? 0,
    outMax:       num(raw['outMax']) ?? 1,
    colorMinArgb: parseCssColorToArgb(str(raw['colorMin'])),
    colorMaxArgb: parseCssColorToArgb(str(raw['colorMax'])),
  };
}

// ── Type guards & helpers ─────────────────────────────────────────────────────

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function num(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  }
  return null;
}

function bool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  return null;
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

/**
 * Parses a `nodePositions` keyframe channel from raw JSON.
 *
 * Returns null when the keyframe doesn't drive the path geometry. Iteration
 * order of the resulting Map matches the JSON object's insertion order, which
 * mirrors the editor's path traversal — required so the renderer can stream
 * entries straight into a `d` string.
 */
function parseNodePositions(v: unknown): ReadonlyMap<string, NodePos> | null {
  if (!isObj(v)) return null;
  const entries = Object.entries(v);
  if (entries.length === 0) return null;
  const out = new Map<string, NodePos>();
  for (const [nodeId, raw] of entries) {
    if (!isObj(raw)) continue;
    const x = num(raw['x']);
    const y = num(raw['y']);
    if (x === null || y === null) continue;
    out.set(nodeId, {
      x, y,
      cpIn:  parseCp(raw['cpIn']),
      cpOut: parseCp(raw['cpOut']),
      isMove: raw['isMove'] === true,
      close:  raw['close']  === true,
    });
  }
  return out.size > 0 ? out : null;
}

function parseCp(v: unknown): { x: number; y: number } | null {
  if (!isObj(v)) return null;
  const x = num(v['x']);
  const y = num(v['y']);
  if (x === null || y === null) return null;
  return { x, y };
}

const EASING_CURVES = new Set<string>([
  'linear', 'ease-in', 'ease-out', 'ease-in-out', 'ease-in-out-back',
  'step', 'bounce-in', 'bounce-out', 'elastic-in', 'elastic-out',
]);

function parseEasingCurve(v: unknown): EasingCurve | null {
  if (typeof v === 'string' && EASING_CURVES.has(v)) return v as EasingCurve;
  return null;
}

const BOUND_PROPERTIES = new Set<string>([
  'x', 'y', 'rotation', 'scaleX', 'scaleY', 'opacity', 'fill', 'stroke',
  'strokeDashOffset',
]);

function isBoundProperty(v: string): v is BoundProperty {
  return BOUND_PROPERTIES.has(v);
}
