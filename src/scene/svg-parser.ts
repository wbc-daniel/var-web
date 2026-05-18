import {
  IDENTITY,
  isIdentity,
  multiplyMatrices,
  type Bounds,
  type LinearGradientPaint,
  type Matrix2D,
  type RadialGradientPaint,
  type SceneNode,
  type SpreadMethod,
  type SvgPaint,
} from './scene-node.js';
import {
  makeCirclePath,
  makeEllipsePath,
  makeLinePath,
  makePolyPath,
  makeRectPath,
  parseSvgPath,
  parseNumberList,
  type PathGeometry,
} from './path-parser.js';

// ── Public API ────────────────────────────────────────────────────────────────

export interface SvgParseResult {
  readonly root: SceneNode;
  readonly sceneIndex: Map<string, SceneNode>;
  readonly warnings: string[];
}

/**
 * Parses the `svgRaw` field of a .var.json document into a SceneNode tree.
 * Unsupported elements/attributes produce entries in warnings rather than
 * throwing.
 */
export function parseSvg(svgRaw: string): SvgParseResult {
  const warnings: string[] = [];

  const doc = new DOMParser().parseFromString(svgRaw, 'image/svg+xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    warnings.push(`SVG parse error: ${parseError.textContent?.trim() ?? 'unknown'}`);
  }

  const rootEl = doc.documentElement;
  if (rootEl.localName !== 'svg') {
    warnings.push(`expected root <svg>, got <${rootEl.localName}>`);
  }

  // Build the id → element index before the main walk so url(#id) references,
  // <use href="#id">, and clip-path="url(#id)" resolve regardless of order.
  const idIndex = new Map<string, Element>();
  buildIdIndex(rootEl, idIndex);

  // Collect class-selector rules from any <style> blocks so elements that style
  // their fill/stroke via `class="cls-X"` (Inkscape/Illustrator output) resolve
  // correctly. Without this, classed elements fall through to the inherited
  // black default and the artwork renders as solid black blobs.
  const classRules = collectClassRules(rootEl);

  const ctx: ParseContext = { idIndex, warnings, classRules };
  const root = parseElement(rootEl, INHERITED_INITIAL, ctx);

  const sceneIndex = new Map<string, SceneNode>();
  buildSceneIndex(root, sceneIndex);

  return { root, sceneIndex, warnings };
}

// ── Flat scene index ──────────────────────────────────────────────────────────

function buildSceneIndex(node: SceneNode, out: Map<string, SceneNode>): void {
  if (node.id !== null) out.set(node.id, node);
  for (const child of node.children) buildSceneIndex(child, out);
}

// ── Id index ──────────────────────────────────────────────────────────────────

function buildIdIndex(el: Element, out: Map<string, Element>): void {
  const id = el.getAttribute('id');
  if (id) out.set(id, el);
  for (const child of el.children) buildIdIndex(child, out);
}

// ── Parse context ─────────────────────────────────────────────────────────────

interface ParseContext {
  readonly idIndex: Map<string, Element>;
  readonly warnings: string[];
  /** className → declaration map (lowercased property → raw value). */
  readonly classRules: Map<string, Map<string, string>>;
}

// ── CSS <style> block collection ──────────────────────────────────────────────

// Walks the tree gathering text from every <style> element and parses the
// simplest CSS subset Inkscape/Illustrator emit: comma-separated class
// selectors with property:value declarations. Anything more exotic (id
// selectors, descendants, media queries, @rules) is ignored — the SVG still
// renders, just without those rules' contributions.
function collectClassRules(root: Element): Map<string, Map<string, string>> {
  const map = new Map<string, Map<string, string>>();
  const visit = (el: Element): void => {
    if (el.localName === 'style') {
      parseStylesheet(el.textContent ?? '', map);
    }
    for (const child of el.children) visit(child);
  };
  visit(root);
  return map;
}

function parseStylesheet(css: string, out: Map<string, Map<string, string>>): void {
  // Strip /* … */ comments first so braces inside them don't break the splitter.
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // Match each "<selectors> { <decls> }" block.
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRe.exec(stripped)) !== null) {
    const selectors = (m[1] ?? '').split(',').map(s => s.trim()).filter(Boolean);
    const decls = parseDeclarations(m[2] ?? '');
    if (decls.size === 0) continue;
    for (const sel of selectors) {
      // Only flat single-class selectors (`.foo`). No combinators or
      // pseudo-classes — those are uncommon in editor-exported SVGs.
      if (!/^\.[A-Za-z_][\w-]*$/.test(sel)) continue;
      const cls = sel.slice(1);
      let bucket = out.get(cls);
      if (!bucket) { bucket = new Map(); out.set(cls, bucket); }
      for (const [k, v] of decls) bucket.set(k, v);
    }
  }
}

function parseDeclarations(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const decl of body.split(';')) {
    const idx = decl.indexOf(':');
    if (idx <= 0) continue;
    const k = decl.slice(0, idx).trim().toLowerCase();
    const v = decl.slice(idx + 1).trim();
    if (k && v) out.set(k, v);
  }
  return out;
}

function lookupClassValue(
  classAttr: string | null,
  classRules: Map<string, Map<string, string>>,
  prop: string,
): string | null {
  if (!classAttr) return null;
  // Last matching class wins (matches simple last-rule cascade).
  let value: string | null = null;
  for (const cls of classAttr.split(/\s+/)) {
    if (!cls) continue;
    const v = classRules.get(cls)?.get(prop);
    if (v !== undefined) value = v;
  }
  return value;
}

// ── Inherited paint & stroke context ─────────────────────────────────────────

interface Inherited {
  readonly fill: SvgPaint | null;
  readonly stroke: SvgPaint | null;
  readonly strokeWidth: number;
  readonly strokeLinecap: 'butt' | 'round' | 'square';
  readonly strokeLinejoin: 'miter' | 'round' | 'bevel';
  readonly strokeDashArray: readonly number[];
  readonly strokeDashOffset: number;
  readonly fillOpacity: number;
  readonly strokeOpacity: number;
}

/** SVG initial values: fill=black, stroke=none, stroke-width=1. */
const INHERITED_INITIAL: Inherited = {
  fill: { kind: 'solid', argb: 0xFF000000 },
  stroke: null,
  strokeWidth: 1,
  strokeLinecap: 'butt',
  strokeLinejoin: 'miter',
  strokeDashArray: [],
  strokeDashOffset: 0,
  fillOpacity: 1,
  strokeOpacity: 1,
};

function applyAttrs(el: Element, parent: Inherited, ctx: ParseContext): Inherited {
  const style = parseStyleAttr(el.getAttribute('style'));
  const classAttr = el.getAttribute('class');
  // Class-rule fallback (from <style> blocks) only kicks in when neither
  // presentation attr nor inline style declares the property — keeps existing
  // attr/style precedence intact while making editor-exported classed SVGs
  // (Inkscape/Illustrator) render with their declared paints.
  const lookup = (name: string): string | null =>
    el.getAttribute(name) ??
    style.get(name) ??
    lookupClassValue(classAttr, ctx.classRules, name) ??
    null;

  let fill: SvgPaint | null = parent.fill;
  const fillRaw = lookup('fill');
  if (fillRaw !== null) fill = parsePaintReference(fillRaw, ctx);

  let stroke: SvgPaint | null = parent.stroke;
  const strokeRaw = lookup('stroke');
  if (strokeRaw !== null) stroke = parsePaintReference(strokeRaw, ctx);

  const strokeWidth  = parseDouble(lookup('stroke-width'))   ?? parent.strokeWidth;
  const fillOpacity  = parseDouble(lookup('fill-opacity'))   ?? parent.fillOpacity;
  const strokeOpacity = parseDouble(lookup('stroke-opacity')) ?? parent.strokeOpacity;

  const linecapRaw = lookup('stroke-linecap');
  const strokeLinecap: 'butt' | 'round' | 'square' =
    linecapRaw === 'round' ? 'round'
    : linecapRaw === 'square' ? 'square'
    : parent.strokeLinecap;

  const linejoinRaw = lookup('stroke-linejoin');
  const strokeLinejoin: 'miter' | 'round' | 'bevel' =
    linejoinRaw === 'round' ? 'round'
    : linejoinRaw === 'bevel' ? 'bevel'
    : parent.strokeLinejoin;

  const dashRaw = lookup('stroke-dasharray');
  const strokeDashArray = dashRaw !== null
    ? parseDashArray(dashRaw)
    : parent.strokeDashArray;
  const strokeDashOffset = parseDouble(lookup('stroke-dashoffset')) ?? parent.strokeDashOffset;

  return {
    fill, stroke,
    strokeWidth, strokeLinecap, strokeLinejoin,
    strokeDashArray, strokeDashOffset,
    fillOpacity, strokeOpacity,
  };
}

/**
 * Parses an SVG stroke-dasharray string into a list of non-negative numbers.
 * Returns [] for `none`, empty input, or any negative value (per SVG spec
 * the property is invalid in those cases). An odd-length list is repeated
 * once so the dash/gap alternation closes cleanly, matching browser behaviour.
 */
function parseDashArray(raw: string): readonly number[] {
  const s = raw.trim().toLowerCase();
  if (!s || s === 'none') return [];
  const nums: number[] = [];
  for (const tok of raw.split(/[\s,]+/)) {
    if (!tok) continue;
    const n = parseFloat(tok);
    if (isNaN(n) || n < 0) return [];
    nums.push(n);
  }
  if (nums.length === 0) return [];
  // Spec: an all-zero array means no dashing.
  if (nums.every(n => n === 0)) return [];
  // Odd-length arrays repeat to even length: "5 3 2" → "5 3 2 5 3 2".
  if (nums.length % 2 === 1) return [...nums, ...nums];
  return nums;
}

function parseStyleAttr(raw: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!raw) return out;
  for (const decl of raw.split(';')) {
    const idx = decl.indexOf(':');
    if (idx <= 0) continue;
    const k = decl.slice(0, idx).trim();
    const v = decl.slice(idx + 1).trim();
    if (k) out.set(k, v);
  }
  return out;
}

// ── Non-rendering tag set ─────────────────────────────────────────────────────

const NON_RENDERING = new Set([
  'defs', 'linearGradient', 'radialGradient', 'clipPath', 'mask',
  'pattern', 'symbol', 'style', 'title', 'desc', 'metadata',
]);

// ── Element parsing ───────────────────────────────────────────────────────────

function parseElement(el: Element, inheritedIn: Inherited, ctx: ParseContext): SceneNode {
  if (el.localName === 'use') return parseUse(el, inheritedIn, ctx);

  const inherited = applyAttrs(el, inheritedIn, ctx);
  const id = el.getAttribute('id');
  const transform = parseTransform(el.getAttribute('transform'), ctx.warnings);
  const opacity = parseDouble(el.getAttribute('opacity')) ?? 1;

  const styleMap = parseStyleAttr(el.getAttribute('style'));
  const clipPathAttr = el.getAttribute('clip-path')
    ?? styleMap.get('clip-path')
    ?? lookupClassValue(el.getAttribute('class'), ctx.classRules, 'clip-path')
    ?? null;
  const clipPath = resolveClipPath(clipPathAttr, ctx);

  let pathGeom: PathGeometry | null = null;
  switch (el.localName) {
    case 'svg':
    case 'g':
      break;
    case 'rect':
      pathGeom = parseRect(el);
      break;
    case 'circle':
      pathGeom = parseCircle(el);
      break;
    case 'ellipse':
      pathGeom = parseEllipse(el);
      break;
    case 'line':
      pathGeom = parseLine(el);
      break;
    case 'polygon':
      pathGeom = parsePoly(el, true);
      break;
    case 'polyline':
      pathGeom = parsePoly(el, false);
      break;
    case 'path': {
      const d = el.getAttribute('d');
      if (d) pathGeom = parseSvgPath(d, ctx.warnings);
      break;
    }
    case 'text':
    case 'image':
      ctx.warnings.push(`<${el.localName}> is not supported; skipping`);
      break;
    default:
      if (!NON_RENDERING.has(el.localName)) {
        ctx.warnings.push(`unknown SVG element <${el.localName}>; skipping`);
      }
  }

  const children: SceneNode[] = [];
  for (const child of el.children) {
    if (NON_RENDERING.has(child.localName)) continue;
    children.push(parseElement(child, inherited, ctx));
  }

  const hasFill = pathGeom !== null;
  return {
    id: id ?? null,
    tagName: el.localName,
    geometry:        pathGeom?.path ?? null,
    geometryBounds:  pathGeom?.bounds ?? null,
    geometryLength:  pathGeom?.length ?? 0,
    geometryClosed:  pathGeom?.closed ?? false,
    fill:   hasFill ? withPaintOpacity(inherited.fill,   inherited.fillOpacity)   : null,
    stroke: hasFill ? withPaintOpacity(inherited.stroke, inherited.strokeOpacity) : null,
    strokeWidth:    inherited.strokeWidth,
    strokeLinecap:  inherited.strokeLinecap,
    strokeLinejoin: inherited.strokeLinejoin,
    strokeDashArray:  inherited.strokeDashArray,
    strokeDashOffset: inherited.strokeDashOffset,
    transform,
    opacity,
    clipPath,
    children,
  };
}

function parseUse(el: Element, inheritedIn: Inherited, ctx: ParseContext): SceneNode {
  // href may be in the xlink namespace — check both.
  const href =
    el.getAttribute('href') ??
    el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ??
    findAttrByLocalName(el, 'href');

  const useX = parseDouble(el.getAttribute('x')) ?? 0;
  const useY = parseDouble(el.getAttribute('y')) ?? 0;
  const ownTransform = parseTransform(el.getAttribute('transform'), ctx.warnings);

  // Compose: ownTransform first, then x/y offset.
  let transform: Matrix2D | null = ownTransform;
  if (useX !== 0 || useY !== 0) {
    const translate: Matrix2D = [1, 0, 0, 1, useX, useY];
    transform = transform ? multiplyMatrices(transform, translate) : translate;
  }
  if (transform && isIdentity(transform)) transform = null;

  const inherited = applyAttrs(el, inheritedIn, ctx);
  const opacity = parseDouble(el.getAttribute('opacity')) ?? 1;

  let resolved: SceneNode | null = null;
  if (href && href.startsWith('#')) {
    const target = ctx.idIndex.get(href.slice(1));
    if (target) {
      resolved = parseElement(target, inherited, ctx);
    } else {
      ctx.warnings.push(`<use> references unknown id "${href.slice(1)}"`);
    }
  } else {
    ctx.warnings.push('<use> without "#..." href; skipping');
  }

  return {
    id: el.getAttribute('id') ?? null,
    tagName: 'use',
    geometry: null,
    geometryBounds: null,
    geometryLength: 0,
    geometryClosed: false,
    fill: null,
    stroke: null,
    strokeWidth: 1,
    strokeLinecap: 'butt',
    strokeLinejoin: 'miter',
    strokeDashArray: [],
    strokeDashOffset: 0,
    transform,
    opacity,
    clipPath: null,
    children: resolved ? [resolved] : [],
  };
}

function findAttrByLocalName(el: Element, name: string): string | null {
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes.item(i);
    if (a && a.localName === name) return a.value;
  }
  return null;
}

// ── Paint & gradient resolution ───────────────────────────────────────────────

const URL_REF_RE = /url\(\s*#([^)\s]+)\s*\)/;

function parsePaintReference(raw: string, ctx: ParseContext): SvgPaint | null {
  const s = raw.trim();
  const urlMatch = URL_REF_RE.exec(s);
  if (urlMatch) {
    const id = urlMatch[1]!;
    const target = ctx.idIndex.get(id);
    if (!target) {
      ctx.warnings.push(`unresolved paint reference url(#${id})`);
      return null;
    }
    switch (target.localName) {
      case 'linearGradient': return parseLinearGradient(target, ctx);
      case 'radialGradient': return parseRadialGradient(target, ctx);
      default:
        ctx.warnings.push(`url(#${id}) points to <${target.localName}>, not a gradient`);
        return null;
    }
  }
  const argb = parseColorToArgb(s, ctx.warnings);
  return argb !== null ? { kind: 'solid', argb } : null;
}

/** Resolves gradient attribute inheritance through an href chain. */
function resolveGradientChain(
  el: Element,
  ctx: ParseContext,
  visited: Set<string> = new Set(),
): { attrs: Map<string, string>; stops: Element[] } {
  const id = el.getAttribute('id') ?? String(el);
  if (visited.has(id)) return { attrs: new Map(), stops: [] };
  visited.add(id);

  const attrs = new Map<string, string>();
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes.item(i);
    if (a) attrs.set(a.localName, a.value);
  }
  const stops = Array.from(el.children).filter(c => c.localName === 'stop');

  const href =
    attrs.get('href') ??
    el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ??
    null;
  if (href && href.startsWith('#')) {
    const target = ctx.idIndex.get(href.slice(1));
    if (target) {
      const parent = resolveGradientChain(target, ctx, visited);
      // Parent attrs as defaults; ours take precedence.
      const merged = new Map([...parent.attrs, ...attrs]);
      const effectiveStops = stops.length > 0 ? stops : parent.stops;
      return { attrs: merged, stops: effectiveStops };
    }
  }
  return { attrs, stops };
}

function parseLinearGradient(el: Element, ctx: ParseContext): LinearGradientPaint {
  const { attrs, stops: stopEls } = resolveGradientChain(el, ctx);

  const x1 = parseLengthOrPercent(attrs.get('x1') ?? null) ?? 0;
  const y1 = parseLengthOrPercent(attrs.get('y1') ?? null) ?? 0;
  const x2 = parseLengthOrPercent(attrs.get('x2') ?? null) ?? 1;
  const y2 = parseLengthOrPercent(attrs.get('y2') ?? null) ?? 0;

  const objectBoundingBox = (attrs.get('gradientUnits') ?? 'objectBoundingBox') === 'objectBoundingBox';
  const spreadMethod = parseSpreadMethod(attrs.get('spreadMethod') ?? null);
  const gradientTransform = parseTransform(attrs.get('gradientTransform') ?? null, ctx.warnings);
  const { colors, stops } = parseStops(stopEls, ctx);

  return { kind: 'linearGradient', x1, y1, x2, y2, colors, stops, spreadMethod, objectBoundingBox, gradientTransform };
}

function parseRadialGradient(el: Element, ctx: ParseContext): RadialGradientPaint {
  const { attrs, stops: stopEls } = resolveGradientChain(el, ctx);

  const cx = parseLengthOrPercent(attrs.get('cx') ?? null) ?? 0.5;
  const cy = parseLengthOrPercent(attrs.get('cy') ?? null) ?? 0.5;
  const r  = parseLengthOrPercent(attrs.get('r')  ?? null) ?? 0.5;
  const fxRaw = parseLengthOrPercent(attrs.get('fx') ?? null);
  const fyRaw = parseLengthOrPercent(attrs.get('fy') ?? null);
  const fx = fxRaw !== null ? fxRaw : null;
  const fy = fyRaw !== null ? fyRaw : null;

  const objectBoundingBox = (attrs.get('gradientUnits') ?? 'objectBoundingBox') === 'objectBoundingBox';
  const spreadMethod = parseSpreadMethod(attrs.get('spreadMethod') ?? null);
  const gradientTransform = parseTransform(attrs.get('gradientTransform') ?? null, ctx.warnings);
  const { colors, stops } = parseStops(stopEls, ctx);

  return { kind: 'radialGradient', cx, cy, r, fx, fy, colors, stops, spreadMethod, objectBoundingBox, gradientTransform };
}

function parseStops(stopEls: Element[], ctx: ParseContext): { colors: number[]; stops: number[] } {
  const colors: number[] = [];
  const stops: number[] = [];

  for (const s of stopEls) {
    const style = parseStyleAttr(s.getAttribute('style'));
    const classAttr = s.getAttribute('class');
    const offset = parseLengthOrPercent(s.getAttribute('offset')) ?? 0;
    const colorRaw = s.getAttribute('stop-color')
      ?? style.get('stop-color')
      ?? lookupClassValue(classAttr, ctx.classRules, 'stop-color')
      ?? 'black';
    const opacityRaw = s.getAttribute('stop-opacity')
      ?? style.get('stop-opacity')
      ?? lookupClassValue(classAttr, ctx.classRules, 'stop-opacity')
      ?? null;
    const baseArgb = parseColorToArgb(colorRaw, ctx.warnings) ?? 0xFF000000;
    const opacity = opacityRaw !== null ? (parseDouble(opacityRaw) ?? 1) : 1;
    colors.push(withArgbOpacity(baseArgb, opacity));
    stops.push(Math.max(0, Math.min(1, offset)));
  }

  if (colors.length === 0) return { colors: [0x00000000, 0x00000000], stops: [0, 1] };
  if (colors.length === 1) {
    return { colors: [colors[0]!, colors[0]!], stops: [stops[0] ?? 0, 1] };
  }
  // Ensure stops are monotonically non-decreasing.
  for (let i = 1; i < stops.length; i++) {
    if (stops[i]! < stops[i - 1]!) stops[i] = stops[i - 1]!;
  }
  return { colors, stops };
}

function parseSpreadMethod(raw: string | null): SpreadMethod {
  if (raw === 'reflect') return 'reflect';
  if (raw === 'repeat') return 'repeat';
  return 'pad';
}

// ── clip-path resolution ──────────────────────────────────────────────────────

function resolveClipPath(raw: string | null, ctx: ParseContext): Path2D | null {
  if (!raw) return null;
  const match = URL_REF_RE.exec(raw);
  if (!match) return null;
  const id = match[1]!;
  const target = ctx.idIndex.get(id);
  if (!target) {
    ctx.warnings.push(`unresolved clip-path reference url(#${id})`);
    return null;
  }
  if (target.localName !== 'clipPath') {
    ctx.warnings.push(`url(#${id}) referenced from clip-path is not a <clipPath>`);
    return null;
  }
  const out = new Path2D();
  for (const child of target.children) {
    const node = parseElement(child, INHERITED_INITIAL, ctx);
    accumulateClipGeometry(node, out, IDENTITY);
  }
  return out;
}

function accumulateClipGeometry(node: SceneNode, out: Path2D, parentTransform: Matrix2D): void {
  const combined: Matrix2D = node.transform
    ? multiplyMatrices(parentTransform, node.transform)
    : parentTransform;

  if (node.geometry) {
    if (isIdentity(combined)) {
      out.addPath(node.geometry);
    } else {
      out.addPath(node.geometry, {
        a: combined[0], b: combined[1],
        c: combined[2], d: combined[3],
        e: combined[4], f: combined[5],
      });
    }
  }
  for (const child of node.children) {
    accumulateClipGeometry(child, out, combined);
  }
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

function parseRect(el: Element): PathGeometry {
  const x  = parseDouble(el.getAttribute('x'))      ?? 0;
  const y  = parseDouble(el.getAttribute('y'))      ?? 0;
  const w  = parseDouble(el.getAttribute('width'))  ?? 0;
  const h  = parseDouble(el.getAttribute('height')) ?? 0;
  const rxRaw = parseDouble(el.getAttribute('rx'));
  const ryRaw = parseDouble(el.getAttribute('ry'));
  const rx = rxRaw ?? ryRaw ?? 0;
  const ry = ryRaw ?? rxRaw ?? 0;
  return makeRectPath(x, y, w, h, rx, ry);
}

function parseCircle(el: Element): PathGeometry {
  const cx = parseDouble(el.getAttribute('cx')) ?? 0;
  const cy = parseDouble(el.getAttribute('cy')) ?? 0;
  const r  = parseDouble(el.getAttribute('r'))  ?? 0;
  return makeCirclePath(cx, cy, r);
}

function parseEllipse(el: Element): PathGeometry {
  const cx = parseDouble(el.getAttribute('cx')) ?? 0;
  const cy = parseDouble(el.getAttribute('cy')) ?? 0;
  const rx = parseDouble(el.getAttribute('rx')) ?? 0;
  const ry = parseDouble(el.getAttribute('ry')) ?? 0;
  return makeEllipsePath(cx, cy, rx, ry);
}

function parseLine(el: Element): PathGeometry {
  const x1 = parseDouble(el.getAttribute('x1')) ?? 0;
  const y1 = parseDouble(el.getAttribute('y1')) ?? 0;
  const x2 = parseDouble(el.getAttribute('x2')) ?? 0;
  const y2 = parseDouble(el.getAttribute('y2')) ?? 0;
  return makeLinePath(x1, y1, x2, y2);
}

function parsePoly(el: Element, close: boolean): PathGeometry {
  return makePolyPath(el.getAttribute('points') ?? '', close);
}

// ── Transform parser ──────────────────────────────────────────────────────────

const TRANSFORM_RE = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;

function parseTransform(raw: string | null, warnings: string[]): Matrix2D | null {
  if (!raw || !raw.trim()) return null;
  let result: Matrix2D = IDENTITY;
  let m: RegExpExecArray | null;
  TRANSFORM_RE.lastIndex = 0;
  while ((m = TRANSFORM_RE.exec(raw)) !== null) {
    const op = m[1]!;
    const args = parseNumberList(m[2]!);
    let mat: Matrix2D;
    switch (op) {
      case 'matrix':
        if (args.length === 6) {
          mat = [args[0]!, args[1]!, args[2]!, args[3]!, args[4]!, args[5]!];
        } else {
          warnings.push(`matrix() transform requires 6 args, got ${args.length}`);
          continue;
        }
        break;
      case 'translate': {
        const tx = args[0] ?? 0;
        const ty = args[1] ?? 0;
        mat = [1, 0, 0, 1, tx, ty];
        break;
      }
      case 'scale': {
        const sx = args[0] ?? 1;
        const sy = args[1] ?? sx;
        mat = [sx, 0, 0, sy, 0, 0];
        break;
      }
      case 'rotate': {
        const deg = args[0] ?? 0;
        const a = (deg * Math.PI) / 180;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        if (args.length >= 3) {
          const cx = args[1]!, cy = args[2]!;
          // translate(cx,cy) * rotate(a) * translate(-cx,-cy)
          const rot: Matrix2D = [cos, sin, -sin, cos, 0, 0];
          const t1: Matrix2D  = [1, 0, 0, 1, cx, cy];
          const t2: Matrix2D  = [1, 0, 0, 1, -cx, -cy];
          mat = multiplyMatrices(multiplyMatrices(t1, rot), t2);
        } else {
          mat = [cos, sin, -sin, cos, 0, 0];
        }
        break;
      }
      case 'skewX': {
        const a = ((args[0] ?? 0) * Math.PI) / 180;
        mat = [1, 0, Math.tan(a), 1, 0, 0];
        break;
      }
      case 'skewY': {
        const a = ((args[0] ?? 0) * Math.PI) / 180;
        mat = [1, Math.tan(a), 0, 1, 0, 0];
        break;
      }
      default:
        warnings.push(`unknown transform op: ${op}`);
        continue;
    }
    result = isIdentity(result) ? mat : multiplyMatrices(result, mat);
  }
  return isIdentity(result) ? null : result;
}

// ── Color parsing ─────────────────────────────────────────────────────────────

const NAMED_COLORS: Record<string, number> = {
  black:   0xFF000000, white:   0xFFFFFFFF, red:     0xFFFF0000,
  green:   0xFF008000, blue:    0xFF0000FF, yellow:  0xFFFFFF00,
  cyan:    0xFF00FFFF, magenta: 0xFFFF00FF, gray:    0xFF808080,
  grey:    0xFF808080, silver:  0xFFC0C0C0, maroon:  0xFF800000,
  olive:   0xFF808000, lime:    0xFF00FF00, aqua:    0xFF00FFFF,
  teal:    0xFF008080, navy:    0xFF000080, fuchsia: 0xFFFF00FF,
  purple:  0xFF800080, orange:  0xFFFFA500, pink:    0xFFFFC0CB,
  brown:   0xFFA52A2A, tan:     0xFFD2B48C, gold:    0xFFFFD700,
  coral:   0xFFFF7F50, salmon:  0xFFFA8072, khaki:   0xFFF0E68C,
  indigo:  0xFF4B0082, violet:  0xFFEE82EE,
};

function parseColorToArgb(raw: string, warnings: string[]): number | null {
  const s = raw.trim().toLowerCase();
  if (!s || s === 'none' || s === 'transparent') return null;

  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0]! + hex[0]!, 16);
      const g = parseInt(hex[1]! + hex[1]!, 16);
      const b = parseInt(hex[2]! + hex[2]!, 16);
      return ((0xFF << 24) | (r << 16) | (g << 8) | b) >>> 0;
    }
    if (hex.length === 6) return ((0xFF << 24) | parseInt(hex, 16)) >>> 0;
    if (hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = parseInt(hex.slice(6, 8), 16);
      return ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
    }
  }

  if (s.startsWith('rgb')) {
    const nums = parseNumberList(s);
    if (nums.length >= 3) {
      const r = clamp(Math.round(nums[0]!), 0, 255);
      const g = clamp(Math.round(nums[1]!), 0, 255);
      const b = clamp(Math.round(nums[2]!), 0, 255);
      // rgba() — 4th arg is 0..1 alpha
      const a = nums.length >= 4 ? clamp(Math.round(nums[3]! * 255), 0, 255) : 255;
      return ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
    }
  }

  const named = NAMED_COLORS[s];
  if (named !== undefined) return named;

  warnings.push(`unrecognised color "${raw}"; treating as transparent`);
  return null;
}

// ── Paint opacity folding ─────────────────────────────────────────────────────

/** Folds an inherited opacity multiplier into a paint source's alpha. */
function withPaintOpacity(paint: SvgPaint | null, opacity: number): SvgPaint | null {
  if (!paint || opacity >= 1) return paint;
  switch (paint.kind) {
    case 'solid':
      return { kind: 'solid', argb: withArgbOpacity(paint.argb, opacity) };
    case 'linearGradient':
      return { ...paint, colors: paint.colors.map(c => withArgbOpacity(c, opacity)) };
    case 'radialGradient':
      return { ...paint, colors: paint.colors.map(c => withArgbOpacity(c, opacity)) };
  }
}

function withArgbOpacity(argb: number, opacity: number): number {
  if (opacity >= 1) return argb;
  const a = (argb >>> 24) & 0xFF;
  const newA = Math.round(a * opacity);
  return ((newA << 24) | (argb & 0x00FFFFFF)) >>> 0;
}

// ── Misc helpers ──────────────────────────────────────────────────────────────

function parseDouble(s: string | null): number | null {
  if (!s) return null;
  const t = s.trim().replace(/(?:px|pt|em|rem)$/, '');
  if (!t) return null;
  const n = parseFloat(t);
  return isNaN(n) ? null : n;
}

function parseLengthOrPercent(s: string | null): number | null {
  if (!s) return null;
  const t = s.trim();
  if (t.endsWith('%')) {
    const v = parseFloat(t.slice(0, -1));
    return isNaN(v) ? null : v / 100;
  }
  return parseDouble(t);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
