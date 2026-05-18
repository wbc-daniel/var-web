// ── Enums ─────────────────────────────────────────────────────────────────────

/** Easing curve identifier as it appears in the .var.json format (kebab-case). */
export type EasingCurve =
  | 'linear'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'ease-in-out-back'
  | 'step'
  | 'bounce-in'
  | 'bounce-out'
  | 'elastic-in'
  | 'elastic-out';

/** Animatable property that a DataBinding can drive. */
export type BoundProperty =
  | 'x'
  | 'y'
  | 'rotation'
  | 'scaleX'
  | 'scaleY'
  | 'opacity'
  | 'fill'
  | 'stroke'
  | 'strokeDashOffset';

/** How an element enters when a state transition begins. */
export type TransitionInType = 'animate' | 'fade';

/** Playback loop behaviour for the active state window. */
export type PlaybackMode = 'loop' | 'oneShot' | 'pingPong';

// ── Viewport ──────────────────────────────────────────────────────────────────

export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
  /** ARGB integer, e.g. 0xFF_FF_FF_FF for opaque white. null = transparent. */
  backgroundArgb: number | null;
}

// ── Keyframes ─────────────────────────────────────────────────────────────────

/** A single anchor on a path. cpIn/cpOut control the bezier handles incident
 *  on this node; isMove starts a new sub-path; close ends the current sub-path. */
export interface NodePos {
  readonly x: number;
  readonly y: number;
  readonly cpIn: { readonly x: number; readonly y: number } | null;
  readonly cpOut: { readonly x: number; readonly y: number } | null;
  readonly isMove: boolean;
  readonly close: boolean;
}

export interface Keyframe {
  id: string;
  /** Milliseconds from the start of the state window. */
  time: number;
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  /** Draw-order override. null = use natural elementOrder position. */
  zIndex: number | null;
  /** Motion-path position 0–100. null = not on a motion path. */
  pathProgress: number | null;
  /**
   * Animated `stroke-dashoffset` for the underlying scene node's stroke. null
   * = this keyframe doesn't drive the offset (resolver leaves it unowned).
   * The dash *pattern* itself comes from the SVG's static `stroke-dasharray`.
   */
  strokeDashOffset: number | null;
  /**
   * Keyframeable visibility. null = transparent (unset), true = hidden
   * (element skipped entirely during paint), false = explicitly shown.
   * Step-hold: the last non-null value at or before the current time is used.
   */
  hidden: boolean | null;
  /**
   * Per-anchor positions for path-node morphing. null when this keyframe does
   * not drive the path geometry. Insertion order matches the original path's
   * `M`/`L`/`C` traversal — preserved via Map iteration order so the renderer
   * can stream node entries straight into a `d` string without re-sorting.
   */
  nodePositions: ReadonlyMap<string, NodePos> | null;
  /** Entry easing into this keyframe from the previous one. */
  curve: EasingCurve;
  /**
   * Selective channel declaration. null = legacy: this keyframe drives all six
   * transform channels. Non-null: only the named channels are owned by this
   * keyframe; others skip it during per-channel interpolation.
   */
  props: ReadonlySet<string> | null;
}

export interface ElementAnimation {
  /** Sorted by time ascending. */
  readonly keyframes: readonly Keyframe[];
}

// ── Data bindings ─────────────────────────────────────────────────────────────

export interface DataBinding {
  id: string;
  property: BoundProperty;
  dataKey: string;
  /** Duration of the settling animation when the external value changes (ms). */
  settlingMs: number;
  curve: EasingCurve;
  /** Input domain clamp. */
  inMin: number;
  inMax: number;
  /** Scalar output range (ignored for color properties). */
  outMin: number;
  outMax: number;
  /** ARGB integers for color lerp endpoints. null when property is not a color. */
  colorMinArgb: number | null;
  colorMaxArgb: number | null;
}

// ── Animated element ──────────────────────────────────────────────────────────

export interface AnimatedElement {
  id: string;
  tagName: string;
  pivotX: number;
  pivotY: number;
  visible: boolean;
  /** Keyed by state name. */
  readonly animations: Readonly<Record<string, ElementAnimation>>;
  readonly dataBindings: readonly DataBinding[];
  /** ID of another AnimatedElement to use as a clip mask. null = no mask. */
  clipMaskId: string | null;
  /**
   * Pre-tessellated polyline geometry baked at export time (option 4 in the
   * designer's runtime-export modal). When present, the renderer uses this
   * Path2D instead of the SVG-derived `SceneNode.geometry`, bypassing curve
   * tessellation on first paint.
   */
  polylinePath: Path2D | null;
  /** Total polyline length (sum of segment lengths). Used for dash scaling on
   *  closed contours. 0 when no polyline is present. */
  polylineLength: number;
  /** True when at least one polyline contour is closed. */
  polylineClosed: boolean;
}

/**
 * Hints recorded by the designer's runtime-export pipeline describing what
 * baking passes have already been applied. Runtimes use these to skip work
 * that's been done upstream (e.g. warm-up cycles when geometry is already
 * pre-tessellated). `null` indicates the export pre-dates this block.
 */
export interface RuntimeHints {
  /** When false, the runtime should skip its warm-up paint cycle. */
  readonly warmUp: boolean;
  /** True when every animated element was sampled at a fixed rate. */
  readonly preSampledKeyframes: boolean;
  /** Hz used for pre-sampling, or null when preSampledKeyframes is false. */
  readonly sampleRate: number | null;
  /** True when path geometry was flattened into polylines at export time. */
  readonly preTessellated: boolean;
  /** Max chord deviation used when flattening, in SVG units. null when off. */
  readonly tessellationFlatness: number | null;
}

// ── State machine ─────────────────────────────────────────────────────────────

export interface TransitionInConfig {
  type: TransitionInType;
  /** Duration of the entrance animation (ms). */
  duration: number;
}

export interface StateConfig {
  /** Total animation length for this state (ms). */
  duration: number;
  /** Playback start within the duration (ms). */
  windowIn: number;
  /** Playback end within the duration (ms). */
  windowOut: number;
  transitionIn: TransitionInConfig;
}

export interface TransitionDefaults {
  duration: number;
  curve: EasingCurve;
}

export interface ElementTransitionOverride {
  /** Extra delay before this element begins its transition (ms). */
  delay: number;
  /** Per-element duration override. null = use the global transition duration. */
  duration: number | null;
  /** Per-element easing override. null = use the global transition curve. */
  curve: EasingCurve | null;
}

export interface StateTransition {
  from: string;
  to: string;
  duration: number;
  curve: EasingCurve;
  /** Per-element timing overrides, keyed by element ID. */
  readonly elements: Readonly<Record<string, ElementTransitionOverride>>;
}

// ── Root document ─────────────────────────────────────────────────────────────

// SceneNode and its sub-types live in src/scene/scene-node.ts. They are
// re-exported from src/index.ts. The interface below uses them by forward
// reference to keep model/types.ts free of scene-graph implementation details.
import type { SceneNode } from '../scene/scene-node.js';

export interface VectorAnimation {
  name: string;
  fps: number;
  svgRaw: string;
  viewport: Viewport;
  readonly states: readonly string[];
  defaultState: string;
  readonly stateConfigs: Readonly<Record<string, StateConfig>>;
  readonly stateTransitions: readonly StateTransition[];
  defaultTransition: TransitionDefaults;
  readonly elements: Readonly<Record<string, AnimatedElement>>;
  readonly elementOrder: readonly string[];
  /** null when the export pre-dates the runtime-hints block. */
  readonly runtimeHints: RuntimeHints | null;
  /** Parsed SVG scene tree. Root node corresponds to the <svg> element. */
  readonly scene: SceneNode;
  /** Flat lookup of scene nodes by SVG id, built at parse time. */
  readonly sceneIndex: ReadonlyMap<string, SceneNode>;
  readonly warnings: readonly string[];
}

// ── Exploration API (runtime-computed, surfaced by the controller) ──────────

/**
 * Static + live description of one state in the animation. Returned by
 * `VectorAnimateController.listStates()` so hosts can build pickers,
 * dropdowns, or debug overlays without poking at internal model fields.
 */
export interface StateInfo {
  name: string;
  /** Total animation length for this state (ms). */
  duration: number;
  /** Playback start within the duration (ms). */
  windowIn: number;
  /** Playback end within the duration (ms). */
  windowOut: number;
  transitionInType: TransitionInType;
  /** Duration of the entrance animation (ms). */
  transitionInDuration: number;
  /** True when this is `animation.defaultState`. */
  isDefault: boolean;
  /** True when this state is currently active on the controller. */
  isCurrent: boolean;
  /** Number of elements that declare a keyframe track for this state. */
  elementCount: number;
}

/**
 * One declared data binding in the animation, decorated with the id of the
 * element that owns it. Returned by `VectorAnimateController.listBindings()`.
 */
export interface DataBindingInfo {
  id: string;
  /** Animated element that declares this binding. */
  elementId: string;
  dataKey: string;
  property: BoundProperty;
  /** True when `property` is `'fill'` or `'stroke'`. */
  isColor: boolean;
  inMin: number;
  inMax: number;
  /** Scalar output range. Meaningful only when `isColor` is false. */
  outMin: number;
  outMax: number;
  /** ARGB endpoint for color bindings. null when `isColor` is false. */
  colorMinArgb: number | null;
  colorMaxArgb: number | null;
  settlingMs: number;
  curve: EasingCurve;
}

/**
 * One data key declared by the animation, the bindings that consume it, and
 * the value (if any) currently held by the controller. Returned by
 * `VectorAnimateController.listDataKeys()`.
 */
export interface DataKeyInfo {
  dataKey: string;
  /** All bindings (across all elements) that read `dataKey`. */
  bindings: readonly DataBindingInfo[];
  /** Last value passed to `setData(dataKey, …)`. undefined when never set. */
  currentValue: number | undefined;
  /** True when a value has been pushed for this key. */
  isSet: boolean;
}

// ── Resolved pose (runtime-computed, not in JSON) ─────────────────────────────

/** Fully-interpolated pose for one element at a single point in time. */
export interface ResolvedElement {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  /** null = natural elementOrder position. */
  zIndex: number | null;
  /** null = not on a motion path. */
  pathProgress: number | null;
  pivotX: number;
  pivotY: number;
  /** ARGB int fill override from a data binding. null = use SVG paint. */
  fillOverride: number | null;
  /** ARGB int stroke override from a data binding. null = use SVG paint. */
  strokeOverride: number | null;
  /**
   * Animated stroke-dashoffset. null = use the scene node's static
   * `strokeDashOffset` value instead.
   */
  strokeDashOffset: number | null;
  /**
   * Keyframeable visibility override. null = unset (element paints normally).
   * true = element is hidden (entire subtree skipped). false = explicitly shown.
   */
  hidden: boolean | null;
  /**
   * Resolved per-anchor positions for path-node morphing. null when no
   * keyframe drives the path geometry — renderer falls back to the static
   * scene-node geometry. Iteration order matches the original path traversal.
   */
  nodePositions: ReadonlyMap<string, NodePos> | null;
}
