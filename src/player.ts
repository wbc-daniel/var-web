import { VectorAnimateController, type StateChangeHandler } from './engine/controller.js';
import { VarLoader } from './loader/loader.js';
import { AnimationRenderer } from './render/animation-renderer.js';
import type { BoxFit } from './render/box-fit.js';
import type {
  DataBindingInfo,
  DataKeyInfo,
  PlaybackMode,
  StateInfo,
  VectorAnimation,
} from './model/types.js';

/** Source the player can construct from. */
export type PlayerSource =
  | string                  // URL — fetched via VarLoader.fromUrl
  | Uint8Array              // raw bytes — auto-detects .var binary vs .var.json
  | VectorAnimation         // already-parsed animation
  | Record<string, unknown>; // pre-decoded JSON object

export interface PlayerOptions {
  /** State to start in. Defaults to `animation.defaultState`. */
  initialState?: string;
  /** Playback mode. Default 'loop'. */
  mode?: PlaybackMode;
  /** Speed multiplier. Default 1.0. */
  speed?: number;
  /** If true, the controller starts playing. Default true. */
  autoplay?: boolean;
  /** Renderer fit mode. Default 'contain'. */
  boxFit?: BoxFit;
}

/** Events emitted by the player's `on()` method. */
export type PlayerEvent = 'stateChange' | 'stateTransitionEnd';

/**
 * Convenience facade combining a `VarLoader` source, a
 * `VectorAnimateController`, and an `AnimationRenderer`. Most apps should use
 * this instead of wiring those parts directly.
 *
 * ```ts
 * const player = await VectorAnimatePlayer.create(canvas, '/anims/card.var');
 * player.setState('hover');
 * player.setData('temperature', 0.75);
 * ```
 *
 * For advanced use the underlying `controller` and `renderer` are exposed.
 */
export class VectorAnimatePlayer {
  readonly canvas: HTMLCanvasElement;
  readonly animation: VectorAnimation;
  readonly controller: VectorAnimateController;
  readonly renderer: AnimationRenderer;

  /**
   * Async factory: resolves [source] to a `VectorAnimation`, builds the
   * controller + renderer, and starts the RAF loop.
   */
  static async create(
    canvas: HTMLCanvasElement,
    source: PlayerSource,
    options: PlayerOptions = {},
  ): Promise<VectorAnimatePlayer> {
    const animation = await resolveSource(source);
    return new VectorAnimatePlayer(canvas, animation, options);
  }

  constructor(
    canvas: HTMLCanvasElement,
    animation: VectorAnimation,
    options: PlayerOptions = {},
  ) {
    this.canvas = canvas;
    this.animation = animation;
    this.controller = new VectorAnimateController(animation, {
      initialState: options.initialState,
      mode:         options.mode,
      speed:        options.speed,
      autoplay:     options.autoplay,
    });
    this.renderer = new AnimationRenderer(canvas, this.controller, {
      boxFit: options.boxFit,
    });
    this.renderer.start();
  }

  // ── Playback delegates ──────────────────────────────────────────────────────

  play():  void { this.controller.play(); }
  pause(): void { this.controller.pause(); }
  stop():  void { this.controller.stop(); }
  seekTo(ms: number): void { this.controller.seekTo(ms); }
  setState(state: string): void { this.controller.setState(state); }

  get currentState():    string  { return this.controller.currentState; }
  get position():        number  { return this.controller.position; }
  get isPlaying():       boolean { return this.controller.isPlaying; }
  get isInTransition():  boolean { return this.controller.isInTransition; }

  get mode(): PlaybackMode   { return this.controller.mode; }
  set mode(value: PlaybackMode) { this.controller.mode = value; }

  get speed(): number   { return this.controller.speed; }
  set speed(value: number) { this.controller.speed = value; }

  get boxFit(): BoxFit  { return this.renderer.boxFit; }
  set boxFit(value: BoxFit) { this.renderer.boxFit = value; }

  // ── Data binding delegates ──────────────────────────────────────────────────

  setData(key: string, value: number): void { this.controller.setData(key, value); }
  setDataMap(values: Record<string, number>): void { this.controller.setDataMap(values); }
  clearData(key: string): void { this.controller.clearData(key); }
  getData(key: string): number | undefined { return this.controller.getData(key); }

  get dataKeys():        IterableIterator<string> { return this.controller.dataKeys; }
  get declaredDataKeys(): Set<string>             { return this.controller.declaredDataKeys; }

  // ── Exploration API delegates ───────────────────────────────────────────────

  /** Snapshot of every state declared by the animation. */
  listStates(): StateInfo[] { return this.controller.listStates(); }
  /** Looks up a single state's metadata by name. */
  getStateInfo(name: string): StateInfo | undefined { return this.controller.getStateInfo(name); }
  /** Every declared `DataBinding`, decorated with its owning element's id. */
  listBindings(): DataBindingInfo[] { return this.controller.listBindings(); }
  /** Every distinct data key, the bindings that consume it, and its current value. */
  listDataKeys(): DataKeyInfo[] { return this.controller.listDataKeys(); }

  // ── Events ──────────────────────────────────────────────────────────────────

  /**
   * Subscribes to a typed player event. Returns an unsubscribe function.
   * Equivalent to calling the matching method on `controller` directly.
   */
  on(event: PlayerEvent, handler: StateChangeHandler): () => void {
    switch (event) {
      case 'stateChange':         return this.controller.onStateChange(handler);
      case 'stateTransitionEnd':  return this.controller.onStateTransitionEnd(handler);
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /** Stops RAF, releases listeners, disconnects the resize observer. */
  dispose(): void {
    this.renderer.dispose();
    this.controller.dispose();
  }
}

// ── Source resolution ─────────────────────────────────────────────────────────

async function resolveSource(source: PlayerSource): Promise<VectorAnimation> {
  if (typeof source === 'string') {
    return VarLoader.fromUrl(source);
  }
  if (source instanceof Uint8Array) {
    return VarLoader.fromBytes(source as Uint8Array<ArrayBuffer>);
  }
  if (isVectorAnimation(source)) {
    return source;
  }
  return VarLoader.fromJson(source);
}

function isVectorAnimation(x: unknown): x is VectorAnimation {
  return typeof x === 'object'
    && x !== null
    && 'sceneIndex' in x
    && (x as { sceneIndex: unknown }).sceneIndex instanceof Map;
}
