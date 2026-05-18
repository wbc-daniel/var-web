import { applyEasing } from './easing.js';
import { blendResolved, identityResolved, resolveElement } from './property-resolver.js';
import {
  argbLerp,
  isColorProperty,
  mapColor,
  mapScalar,
} from './data-binding.js';
import type {
  AnimatedElement,
  DataBinding,
  DataBindingInfo,
  DataKeyInfo,
  EasingCurve,
  PlaybackMode,
  ResolvedElement,
  StateInfo,
  StateTransition,
  VectorAnimation,
} from '../model/types.js';

// ── Public option / event types ───────────────────────────────────────────────

export interface ControllerOptions {
  /** State to start in. Defaults to `animation.defaultState`. */
  initialState?: string;
  /** Playback mode. Default 'loop'. */
  mode?: PlaybackMode;
  /** Speed multiplier. Default 1.0. */
  speed?: number;
  /** If true, the controller starts in the playing state. Default true. */
  autoplay?: boolean;
}

export type Listener = () => void;

export interface StateChangeEvent {
  readonly from: string;
  readonly to: string;
}

export type StateChangeHandler = (event: StateChangeEvent) => void;

// ── Internal binding settle state ─────────────────────────────────────────────

interface BindingRtState {
  /** Scalar value (number) or ARGB int — both fit in a JS number. */
  startValue: number;
  targetValue: number;
  startTsMs: number;
  settlingMs: number;
  curve: EasingCurve;
  /** Last raw external value the binding was retargeted toward. */
  lastRaw: number;
}

// ── Controller ────────────────────────────────────────────────────────────────

/**
 * Mutable playback state for a [VectorAnimation].
 *
 * The controller does not own a clock — call [advance] once per frame with
 * the elapsed delta (typically from a `requestAnimationFrame` loop). After
 * each advance, listeners registered via [addListener] are notified so
 * downstream renderers can repaint.
 */
export class VectorAnimateController {
  readonly animation: VectorAnimation;

  mode: PlaybackMode;
  speed: number;

  private _currentState: string;
  private _stateTimeMs: number;
  private _isPlaying: boolean;
  private _direction: 1 | -1 = 1;

  /** Monotonic clock advanced unconditionally each tick. Used as "now" for
   *  binding settling, which keeps progressing even when playback is paused. */
  private _wallClockMs = 0;

  // ── Transition state ────────────────────────────────────────────────────────
  private _inTransition = false;
  private _isFadeTransition = false;
  private _transitionElapsedMs = 0;
  private _transitionMaxDurationMs = 0;
  private _transitionFadeDurationMs = 0;
  private _activeTransition: StateTransition | null = null;
  private _snapshot = new Map<string, ResolvedElement>();
  /** Recorded at setState time so `onStateTransitionEnd` knows the prior state. */
  private _transitionFromState: string | null = null;

  // ── Data-binding state ──────────────────────────────────────────────────────
  private _dataValues = new Map<string, number>();
  private _bindingState = new Map<string, BindingRtState>();
  /** Forces a repaint on the next advance even when nothing else changed. */
  private _bindingDirty = false;

  // ── Listeners ───────────────────────────────────────────────────────────────
  private _listeners = new Set<Listener>();
  private _stateChangeHandlers = new Set<StateChangeHandler>();
  private _stateTransitionEndHandlers = new Set<StateChangeHandler>();

  constructor(animation: VectorAnimation, options: ControllerOptions = {}) {
    this.animation = animation;
    this.mode = options.mode ?? 'loop';
    this.speed = options.speed ?? 1.0;
    this._isPlaying = options.autoplay ?? true;

    let initial = options.initialState ?? animation.defaultState;
    if (!animation.states.includes(initial) && animation.states.length > 0) {
      initial = animation.states[0]!;
    }
    this._currentState = initial;
    this._stateTimeMs = animation.stateConfigs[initial]?.windowIn ?? 0;
  }

  // ── Public read-only surface ────────────────────────────────────────────────

  get currentState(): string { return this._currentState; }
  get position(): number { return this._stateTimeMs; }
  get isPlaying(): boolean { return this._isPlaying; }
  get isInTransition(): boolean { return this._inTransition; }

  /** Global opacity for the fade-in effect when the active state's
   *  transitionIn type is `fade`. Returns 1.0 when no fade is in progress. */
  get transitionInFadeOpacity(): number {
    if (!this._inTransition || !this._isFadeTransition) return 1.0;
    if (this._transitionFadeDurationMs <= 0) return 1.0;
    const t = this._transitionElapsedMs / this._transitionFadeDurationMs;
    return t < 0 ? 0 : t > 1 ? 1 : t;
  }

  // ── Playback controls ───────────────────────────────────────────────────────

  play(): void {
    if (this._isPlaying) return;
    this._isPlaying = true;
    this._notify();
  }

  pause(): void {
    if (!this._isPlaying) return;
    this._isPlaying = false;
    this._notify();
  }

  /** Pauses and rewinds the active state to its windowIn. */
  stop(): void {
    this._isPlaying = false;
    this._stateTimeMs = this.animation.stateConfigs[this._currentState]?.windowIn ?? 0;
    this._direction = 1;
    this._notify();
  }

  /** Jumps to [ms] within the active state, clamped to [windowIn, windowOut]. */
  seekTo(ms: number): void {
    const cfg = this.animation.stateConfigs[this._currentState];
    let t = ms;
    if (cfg) {
      if (t < cfg.windowIn) t = cfg.windowIn;
      if (t > cfg.windowOut) t = cfg.windowOut;
    }
    this._stateTimeMs = t;
    this._notify();
  }

  // ── State machine ──────────────────────────────────────────────────────────

  /**
   * Switches to [targetState]. No-op when already in that state and not mid-
   * transition. Throws if [targetState] is not declared in the animation.
   * Fires `onStateChange` synchronously.
   */
  setState(targetState: string): void {
    if (!this.animation.states.includes(targetState)) {
      throw new Error(
        `unknown state "${targetState}" (known: ${this.animation.states.join(', ')})`,
      );
    }
    if (targetState === this._currentState && !this._inTransition) return;

    // Snapshot current resolved poses using the *pre-flip* state.
    this._snapshot = this.resolveAll();

    const from = this._currentState;
    this._currentState = targetState;
    this._stateTimeMs = this.animation.stateConfigs[targetState]?.windowIn ?? 0;
    this._direction = 1;
    this._transitionFromState = from;

    const transitionIn = this.animation.stateConfigs[targetState]?.transitionIn;
    this._isFadeTransition = transitionIn?.type === 'fade';
    this._transitionFadeDurationMs = transitionIn?.duration ?? 300;

    if (this._isFadeTransition) {
      // Fade: no positional blending; transitionMax = fade duration.
      this._activeTransition = null;
      this._transitionMaxDurationMs = this._transitionFadeDurationMs;
    } else {
      this._activeTransition = findTransition(this.animation.stateTransitions, from, targetState);
      const globalDur = this._activeTransition?.duration ?? this.animation.defaultTransition.duration;
      let maxEnd = globalDur;
      if (this._activeTransition) {
        for (const ov of Object.values(this._activeTransition.elements)) {
          const end = ov.delay + (ov.duration ?? globalDur);
          if (end > maxEnd) maxEnd = end;
        }
      }
      this._transitionMaxDurationMs = maxEnd;
    }
    this._transitionElapsedMs = 0;
    this._inTransition = this._transitionMaxDurationMs > 0;

    this._fireStateChange({ from, to: targetState });
    this._notify();
  }

  // ── Data-binding API ───────────────────────────────────────────────────────

  /**
   * Pushes an external value into the animation. Any binding whose `dataKey`
   * matches retargets toward the new value over its `settlingMs`. Settlement
   * continues even while playback is paused.
   */
  setData(key: string, value: number): void {
    this._setDataKey(key, value);
    this._bindingDirty = true;
    this._notify();
  }

  /** Bulk variant of [setData]; fires a single notification. */
  setDataMap(values: Record<string, number>): void {
    let changed = false;
    for (const [k, v] of Object.entries(values)) {
      this._setDataKey(k, v);
      changed = true;
    }
    if (!changed) return;
    this._bindingDirty = true;
    this._notify();
  }

  /**
   * Removes the data value for [key] and discards any in-flight settle state
   * for bindings using it. Subsequent frames render those bindings as if no
   * external value had been set (i.e. keyframe values take over).
   */
  clearData(key: string): void {
    if (!this._dataValues.delete(key)) return;
    for (const el of Object.values(this.animation.elements)) {
      for (const b of el.dataBindings) {
        if (b.dataKey === key) this._bindingState.delete(b.id);
      }
    }
    this._bindingDirty = true;
    this._notify();
  }

  /** Returns the last value passed to [setData] for [key], or undefined. */
  getData(key: string): number | undefined {
    return this._dataValues.get(key);
  }

  /** Iterable over all keys currently set via [setData] / [setDataMap]. */
  get dataKeys(): IterableIterator<string> {
    return this._dataValues.keys();
  }

  /** All `DataBinding.dataKey`s declared by the animation. */
  get declaredDataKeys(): Set<string> {
    const out = new Set<string>();
    for (const el of Object.values(this.animation.elements)) {
      for (const b of el.dataBindings) out.add(b.dataKey);
    }
    return out;
  }

  // ── Exploration API ────────────────────────────────────────────────────────

  /**
   * Snapshot of every state declared by the animation. Result order matches
   * `animation.states`. Use this to populate state pickers, debug overlays,
   * or to discover which states have shorter playback windows.
   */
  listStates(): StateInfo[] {
    const out: StateInfo[] = [];
    for (const name of this.animation.states) {
      const cfg = this.animation.stateConfigs[name];
      let elementCount = 0;
      for (const el of Object.values(this.animation.elements)) {
        if (el.animations[name]) elementCount += 1;
      }
      out.push({
        name,
        duration:             cfg?.duration ?? 0,
        windowIn:             cfg?.windowIn ?? 0,
        windowOut:            cfg?.windowOut ?? 0,
        transitionInType:     cfg?.transitionIn.type ?? 'animate',
        transitionInDuration: cfg?.transitionIn.duration ?? 0,
        isDefault:            name === this.animation.defaultState,
        isCurrent:            name === this._currentState,
        elementCount,
      });
    }
    return out;
  }

  /** Looks up a single state's metadata by name. Undefined if unknown. */
  getStateInfo(name: string): StateInfo | undefined {
    return this.listStates().find(s => s.name === name);
  }

  /**
   * Every `DataBinding` declared in the animation, decorated with the id of
   * the element that owns it. Result order matches `animation.elementOrder`,
   * then per-element `dataBindings` order.
   */
  listBindings(): DataBindingInfo[] {
    const out: DataBindingInfo[] = [];
    for (const elementId of this.animation.elementOrder) {
      const el = this.animation.elements[elementId];
      if (!el) continue;
      for (const b of el.dataBindings) {
        out.push(toBindingInfo(b, elementId));
      }
    }
    return out;
  }

  /**
   * Every distinct `DataBinding.dataKey` declared in the animation, the
   * bindings that consume each key, and the controller's current value for
   * that key (if any). Order is first-seen during element iteration.
   */
  listDataKeys(): DataKeyInfo[] {
    const byKey = new Map<string, DataBindingInfo[]>();
    for (const info of this.listBindings()) {
      let bucket = byKey.get(info.dataKey);
      if (!bucket) {
        bucket = [];
        byKey.set(info.dataKey, bucket);
      }
      bucket.push(info);
    }
    const out: DataKeyInfo[] = [];
    for (const [dataKey, bindings] of byKey) {
      const currentValue = this._dataValues.get(dataKey);
      out.push({
        dataKey,
        bindings,
        currentValue,
        isSet: currentValue !== undefined,
      });
    }
    return out;
  }

  private _setDataKey(key: string, value: number): void {
    const prev = this._dataValues.get(key);
    this._dataValues.set(key, value);
    for (const el of Object.values(this.animation.elements)) {
      for (const b of el.dataBindings) {
        if (b.dataKey !== key) continue;
        const state = this._bindingState.get(b.id);
        if (state === undefined || state.lastRaw !== value || prev === undefined) {
          this._retargetBinding(b, value);
        }
      }
    }
  }

  private _retargetBinding(b: DataBinding, raw: number): void {
    const prev = this._bindingState.get(b.id);
    const current = prev !== undefined
      ? this._evalBindingCurrent(b, prev)
      : this._evalBinding(b, raw);
    this._bindingState.set(b.id, {
      startValue:  current,
      targetValue: this._evalBinding(b, raw),
      startTsMs:   this._wallClockMs,
      settlingMs:  b.settlingMs < 0 ? 0 : b.settlingMs,
      curve:       b.curve,
      lastRaw:     raw,
    });
  }

  private _evalBinding(b: DataBinding, raw: number): number {
    return isColorProperty(b.property) ? mapColor(b, raw) : mapScalar(b, raw);
  }

  private _evalBindingCurrent(b: DataBinding, state: BindingRtState): number {
    const elapsed = this._wallClockMs - state.startTsMs;
    if (state.settlingMs <= 0 || elapsed >= state.settlingMs) return state.targetValue;
    let t = elapsed / state.settlingMs;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    const eased = applyEasing(state.curve, t);
    if (isColorProperty(b.property)) {
      return argbLerp(state.startValue, state.targetValue, eased);
    }
    return state.startValue + (state.targetValue - state.startValue) * eased;
  }

  private _anyBindingSettling(): boolean {
    for (const s of this._bindingState.values()) {
      if (s.settlingMs <= 0) continue;
      if (this._wallClockMs - s.startTsMs < s.settlingMs) return true;
    }
    return false;
  }

  // ── Frame advancement ───────────────────────────────────────────────────────

  /**
   * Advances the playback clock by [dtMs] milliseconds. Typically called from
   * a `requestAnimationFrame` loop with the per-frame delta. Notifies listeners
   * if this tick produces a new pose.
   */
  advance(dtMs: number): void {
    if (dtMs <= 0) return;
    this._wallClockMs += dtMs;

    const bindingActive = this._anyBindingSettling();
    const repaint = this._isPlaying || bindingActive || this._bindingDirty;

    if (this._isPlaying) {
      this._advanceStateClock(dtMs);
      if (this._inTransition) {
        this._transitionElapsedMs += dtMs * this.speed;
        if (this._transitionElapsedMs >= this._transitionMaxDurationMs) {
          const from = this._transitionFromState ?? this._currentState;
          const to = this._currentState;
          this._inTransition = false;
          this._isFadeTransition = false;
          this._activeTransition = null;
          this._snapshot.clear();
          this._transitionFromState = null;
          this._fireStateTransitionEnd({ from, to });
        }
      }
    }

    if (repaint) {
      this._bindingDirty = false;
      this._notify();
    }
  }

  private _advanceStateClock(dtMs: number): void {
    const cfg = this.animation.stateConfigs[this._currentState];
    if (!cfg) return;
    const span = cfg.windowOut - cfg.windowIn;
    if (span <= 0) {
      this._stateTimeMs = cfg.windowIn;
      return;
    }
    const step = dtMs * this.speed;

    switch (this.mode) {
      case 'loop': {
        let u = (this._stateTimeMs + step - cfg.windowIn) % span;
        if (u < 0) u += span;
        this._stateTimeMs = cfg.windowIn + u;
        break;
      }
      case 'oneShot': {
        const t = this._stateTimeMs + step;
        if (t <= cfg.windowIn) {
          this._stateTimeMs = cfg.windowIn;
        } else if (t >= cfg.windowOut) {
          this._stateTimeMs = cfg.windowOut;
          this._isPlaying = false;
        } else {
          this._stateTimeMs = t;
        }
        break;
      }
      case 'pingPong': {
        let remaining = step;
        while (remaining > 0) {
          const boundary = this._direction > 0 ? cfg.windowOut : cfg.windowIn;
          const distance = (boundary - this._stateTimeMs) * this._direction;
          if (remaining < distance) {
            this._stateTimeMs += remaining * this._direction;
            remaining = 0;
          } else {
            this._stateTimeMs = boundary;
            remaining -= distance;
            this._direction = this._direction === 1 ? -1 : 1;
          }
        }
        break;
      }
    }
  }

  // ── Pose resolution ─────────────────────────────────────────────────────────

  /** Computes the resolved pose for every element at the current frame. */
  resolveAll(): Map<string, ResolvedElement> {
    const out = new Map<string, ResolvedElement>();
    for (const id of this.animation.elementOrder) {
      const el = this.animation.elements[id];
      if (!el) continue;
      let pose = resolveElement(el, this._currentState, this._stateTimeMs);
      if (this._inTransition) pose = this._applyTransition(pose, el);
      if (el.dataBindings.length > 0) pose = this._applyBindings(pose, el);
      out.set(id, pose);
    }
    return out;
  }

  private _applyTransition(target: ResolvedElement, el: AnimatedElement): ResolvedElement {
    // Fade type: positions are already at target; opacity is applied globally
    // by the renderer via [transitionInFadeOpacity].
    if (this._isFadeTransition) return target;

    const globalDur   = this._activeTransition?.duration ?? this.animation.defaultTransition.duration;
    const globalCurve = this._activeTransition?.curve    ?? this.animation.defaultTransition.curve;
    const ov          = this._activeTransition?.elements[el.id];
    const delay    = ov?.delay ?? 0;
    const duration = ov?.duration ?? globalDur;
    const curve    = ov?.curve    ?? globalCurve;

    const elapsed = this._transitionElapsedMs - delay;
    if (elapsed <= 0) {
      return this._snapshot.get(el.id) ?? identityResolved(el);
    }
    if (duration <= 0) return target;
    let p = elapsed / duration;
    if (p < 0) p = 0;
    if (p > 1) p = 1;
    const eased = applyEasing(curve, p);
    if (eased >= 1) return target;
    const from = this._snapshot.get(el.id) ?? identityResolved(el);
    return blendResolved(from, target, eased);
  }

  private _applyBindings(base: ResolvedElement, el: AnimatedElement): ResolvedElement {
    let { x, y, rotation, scaleX, scaleY, opacity } = base;
    let fillOverride   = base.fillOverride;
    let strokeOverride = base.strokeOverride;
    let strokeDashOffset = base.strokeDashOffset;

    for (const b of el.dataBindings) {
      const raw = this._dataValues.get(b.dataKey);
      if (raw === undefined) continue;
      const state = this._bindingState.get(b.id);
      const value = state !== undefined
        ? this._evalBindingCurrent(b, state)
        : this._evalBinding(b, raw);

      switch (b.property) {
        case 'x':        x        = value; break;
        case 'y':        y        = value; break;
        case 'rotation': rotation = value; break;
        case 'scaleX':   scaleX   = value; break;
        case 'scaleY':   scaleY   = value; break;
        case 'opacity':  opacity  = value; break;
        case 'fill':     fillOverride   = value; break;
        case 'stroke':   strokeOverride = value; break;
        case 'strokeDashOffset': strokeDashOffset = value; break;
      }
    }

    return {
      x, y, rotation, scaleX, scaleY, opacity,
      zIndex:        base.zIndex,
      hidden:        base.hidden,
      pathProgress:  base.pathProgress,
      pivotX:        base.pivotX,
      pivotY:        base.pivotY,
      fillOverride, strokeOverride,
      strokeDashOffset,
      nodePositions: base.nodePositions,
    };
  }

  // ── Listener / event support ────────────────────────────────────────────────

  /** Registers a listener that fires whenever playback state changes.
   *  Returns an unsubscribe function. */
  addListener(fn: Listener): () => void {
    this._listeners.add(fn);
    return () => { this._listeners.delete(fn); };
  }

  removeListener(fn: Listener): void {
    this._listeners.delete(fn);
  }

  /** Fires synchronously inside [setState]. Returns an unsubscribe function. */
  onStateChange(handler: StateChangeHandler): () => void {
    this._stateChangeHandlers.add(handler);
    return () => { this._stateChangeHandlers.delete(handler); };
  }

  /** Fires when a state transition's blend completes. Returns an unsubscribe. */
  onStateTransitionEnd(handler: StateChangeHandler): () => void {
    this._stateTransitionEndHandlers.add(handler);
    return () => { this._stateTransitionEndHandlers.delete(handler); };
  }

  protected _notify(): void {
    for (const l of this._listeners) l();
  }

  private _fireStateChange(event: StateChangeEvent): void {
    for (const h of this._stateChangeHandlers) h(event);
  }

  private _fireStateTransitionEnd(event: StateChangeEvent): void {
    for (const h of this._stateTransitionEndHandlers) h(event);
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /** Releases listeners. Call when the controller is no longer in use. */
  dispose(): void {
    this._listeners.clear();
    this._stateChangeHandlers.clear();
    this._stateTransitionEndHandlers.clear();
  }
}

// ── Module-level helpers ──────────────────────────────────────────────────────

function findTransition(
  transitions: readonly StateTransition[],
  from: string,
  to: string,
): StateTransition | null {
  for (const t of transitions) {
    if (t.from === from && t.to === to) return t;
  }
  return null;
}

function toBindingInfo(b: DataBinding, elementId: string): DataBindingInfo {
  return {
    id:           b.id,
    elementId,
    dataKey:      b.dataKey,
    property:     b.property,
    isColor:      isColorProperty(b.property),
    inMin:        b.inMin,
    inMax:        b.inMax,
    outMin:       b.outMin,
    outMax:       b.outMax,
    colorMinArgb: b.colorMinArgb,
    colorMaxArgb: b.colorMaxArgb,
    settlingMs:   b.settlingMs,
    curve:        b.curve,
  };
}
