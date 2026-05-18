export type {
  AnimatedElement,
  BoundProperty,
  DataBinding,
  DataBindingInfo,
  DataKeyInfo,
  EasingCurve,
  ElementAnimation,
  ElementTransitionOverride,
  Keyframe,
  PlaybackMode,
  ResolvedElement,
  StateConfig,
  StateInfo,
  StateTransition,
  TransitionDefaults,
  TransitionInConfig,
  TransitionInType,
  VectorAnimation,
  Viewport,
} from './model/types.js';

export type {
  Bounds,
  LinearGradientPaint,
  Matrix2D,
  RadialGradientPaint,
  SceneNode,
  SolidPaint,
  SpreadMethod,
  SvgPaint,
} from './scene/scene-node.js';

export { IDENTITY, isIdentity, multiplyMatrices } from './scene/scene-node.js';
export { parseSvg } from './scene/svg-parser.js';
export { VarLoader } from './loader/loader.js';
export { parseCssColorToArgb, argbToCss } from './loader/css-color.js';
export { applyEasing, lerp, lerpAngleDeg, lerpNullable } from './engine/easing.js';
export {
  blendResolved,
  identityResolved,
  resolveElement,
  resolvedFromKeyframe,
} from './engine/property-resolver.js';
export { VectorAnimateController } from './engine/controller.js';
export type {
  ControllerOptions,
  Listener,
  StateChangeEvent,
  StateChangeHandler,
} from './engine/controller.js';
export { mapScalar, mapColor, argbLerp, isColorProperty } from './engine/data-binding.js';
export { AnimationRenderer } from './render/animation-renderer.js';
export type { RendererOptions } from './render/animation-renderer.js';
export { applyBoxFit } from './render/box-fit.js';
export type { BoxFit } from './render/box-fit.js';
export { resolvePaint } from './render/paint.js';
export { VectorAnimatePlayer } from './player.js';
export type { PlayerEvent, PlayerOptions, PlayerSource } from './player.js';
