# vector_animate_web — TypeScript Web Runtime

TypeScript runtime that plays `.var` / `.var.json` animation files in the browser, matching the full feature set of the Flutter runtime.

**File format:**
| Extension | Content |
|---|---|
| `.var.json` | Baked runtime-only JSON (`runtimeOnly: true`, bones pre-baked, editor fields stripped) |
| `.var` | Baked runtime-only binary (gzip-compressed JSON with `VAB\x01` magic header `[0x56,0x41,0x42,0x01]`) |

The runtime only loads `.var` and `.var.json`. Designer exports (`.va`, `.va.json`) are not supported.

---

## Phase 1 — Data Models & File Loading

- [x] Define TypeScript interfaces for all models:
  - [x] `VectorAnimation` (root document)
  - [x] `Viewport` (x, y, width, height, backgroundArgb)
  - [x] `Keyframe` (id, time, x, y, rotation, scaleX, scaleY, opacity, zIndex, pathProgress, curve, props)
  - [x] `ElementAnimation` (keyframes list)
  - [x] `AnimatedElement` (id, tagName, pivotX, pivotY, visible, animations, dataBindings, clipMaskId)
  - [x] `DataBinding` (id, property, dataKey, settlingMs, curve, inMin, inMax, outMin, outMax, colorMinArgb, colorMaxArgb)
  - [x] `StateConfig` (duration, windowIn, windowOut, transitionIn)
  - [x] `TransitionInConfig` (type, duration)
  - [x] `StateTransition` (from, to, duration, curve, elements)
  - [x] `ElementTransitionOverride` (delay, duration, curve)
  - [x] `TransitionDefaults` (duration, curve)
  - [x] `ResolvedElement` (x, y, rotation, scaleX, scaleY, opacity, zIndex, pathProgress, pivotX, pivotY, fillOverride, strokeOverride)
  - [x] Enums: `PlaybackMode`, `TransitionInType`, `BoundProperty`, `EasingCurve`
- [x] Implement `.var.json` loader (parse UTF-8 JSON)
- [x] Implement `.var` binary loader (detect `VAB\x01` magic header `[0x56,0x41,0x42,0x01]`, gunzip, then parse JSON)
- [x] `fromUrl(url: string)` — fetch and parse from URL
- [x] `fromJson(obj: object)` — parse pre-decoded object
- [x] `fromJsonString(raw: string)` — parse JSON string
- [x] `fromBytes(bytes: Uint8Array)` — auto-detect binary vs text

---

## Phase 2 — SVG Parsing & Scene Graph

- [x] Parse `svgRaw` string into a `SceneNode` tree
  - [x] Tag support: `path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `g`, `use`, `defs`
  - [x] Parse `id` attributes (link to `AnimatedElement` entries)
  - [x] Parse `fill` and `stroke` attributes into paint objects
  - [x] Parse `stroke-width`, `stroke-linecap`, `stroke-linejoin`
  - [x] Parse static `opacity` and `display`/`visibility`
  - [x] Parse `transform` attribute into a matrix (translate, rotate, scale, skew, matrix forms)
  - [x] Parse `clip-path` attribute (link to `<clipPath>` definitions)
  - [x] Parse `<defs>` section: `<linearGradient>`, `<radialGradient>`, `<clipPath>`
  - [x] Resolve `gradientUnits` (objectBoundingBox vs userSpaceOnUse)
  - [x] Resolve `gradientTransform`
  - [x] Resolve `xlink:href` / `href` references (`<use>` and gradient inheritance)
  - [x] Convert shape primitives (rect, circle, etc.) to `Path2D`-compatible descriptions
  - [x] Build flat `sceneIndex: Map<id, SceneNode>` for O(1) lookup
- [x] Define `SvgPaint` sealed union: `SolidPaint`, `LinearGradientPaint`, `RadialGradientPaint`

---

## Phase 3 — Easing & Interpolation

- [x] Implement all 10 `EasingCurve` functions:
  - [x] `linear`
  - [x] `easeIn` (cubic)
  - [x] `easeOut` (cubic)
  - [x] `easeInOut` (cubic)
  - [x] `easeInOutBack` (overshoot)
  - [x] `step` (instant)
  - [x] `bounceIn`
  - [x] `bounceOut`
  - [x] `elasticIn`
  - [x] `elasticOut`
- [x] Implement keyframe interpolation per channel:
  - [x] Find surrounding keyframes by `time`
  - [x] Respect `props` set for per-channel narrowing (only interpolate declared channels)
  - [x] Legacy keyframes (`props` undefined) drive all six transform channels
  - [x] Apply entry easing `curve` of the later keyframe
  - [x] Rotation shortest-path interpolation at state boundaries

---

## Phase 4 — Playback Controller

- [x] `VectorAnimateController` class:
  - [x] Constructor accepts `VectorAnimation`
  - [x] Externally-driven clock via `advance(dtMs)` (RAF integration belongs to the renderer/player)
  - [x] `play()` / `pause()` / `stop()` (pause + rewind to `windowIn`)
  - [x] `seekTo(ms: number)` — jump to position, clamped to `[windowIn, windowOut]`
  - [x] `position: number` (current ms within state)
  - [x] `isPlaying: boolean`
  - [x] `currentState: string`
  - [x] `mode: PlaybackMode` (loop / oneShot / pingPong)
  - [x] `speed: number` (multiplier, default 1.0)
  - [x] Loop: wrap playhead at `windowOut` back to `windowIn`
  - [x] OneShot: stop at `windowOut`
  - [x] PingPong: bounce direction at `windowIn` and `windowOut`
  - [x] `resolveAll(): Map<string, ResolvedElement>` — compute all element poses at current frame
  - [x] `advance(dtMs: number)` — advance clock (transition + binding settling come in Phases 5–6)

---

## Phase 5 — State Machine & Transitions

- [x] `setState(targetState: string)` — switch state
  - [x] Throw on unknown state name (matches Flutter `ArgumentError`)
  - [x] No-op when already in target state and not mid-transition
  - [x] Snapshot current resolved poses of all elements (using the *pre-flip* state)
  - [x] Flip `_currentState` to target, rewind state clock to its `windowIn`, reset direction = forward
  - [x] Read `transitionIn` config from the **target** state's `StateConfig.transitionIn`
  - [x] `TransitionInType.fade`: skip transition lookup; `transitionMaxDuration = transitionIn.duration`; drive `transitionInFadeOpacity` from elapsed
  - [x] `TransitionInType.animate`:
    - [x] Look up `StateTransition` for `from → to`; fall back to `defaultTransition` for global duration/curve
    - [x] Compute `transitionMaxDuration = max(globalDur, max over overrides of (delay + (duration ?? globalDur)))`
    - [x] Per-element blend: while `elapsed < delay`, hold snapshot pose; once `elapsed >= delay`, blend snapshot → target over per-element `(delay, duration, curve)` (falling back to global)
- [x] `advance(dtMs)` integration:
  - [x] Advance `_transitionElapsedMs` by `dtMs * speed` while playing and `_inTransition`
  - [x] When `_transitionElapsedMs >= _transitionMaxDuration`, clear transition state and fire `onStateTransitionEnd`
- [x] Public surface additions to controller:
  - [x] `isInTransition: boolean`
  - [x] `transitionInFadeOpacity: number` (1.0 when no fade in progress)
- [x] Typed event emitter:
  - [x] `onStateChange(handler: (e: { from, to }) => void): unsubscribe` — fires synchronously inside `setState`
  - [x] `onStateTransitionEnd(handler: (e: { from, to }) => void): unsubscribe` — fires when blend completes
- [x] Wire `_applyTransition` into `resolveAll()` so resolved poses are blended during transitions

---

## Phase 6 — Data Bindings

- [x] Public API on the controller:
  - [x] `setData(key: string, value: number)` — push external scalar value, retarget bindings, set `_bindingDirty`, notify
  - [x] `setDataMap(map: Record<string, number>)` — bulk push, single notify
  - [x] `clearData(key: string)` — remove value, drop settle state for affected bindings, set `_bindingDirty`
  - [x] `getData(key: string): number | undefined`
  - [x] `dataKeys: Iterable<string>` — currently-set keys
  - [x] `declaredDataKeys: Set<string>` — all keys referenced by any binding
- [x] Pure mapping functions (unit-testable, no controller state):
  - [x] `mapScalar(binding, raw)` → linear `[inMin, inMax] → [outMin, outMax]`, clamped at boundaries
  - [x] `mapColor(binding, raw)` → ARGB lerp between `colorMinArgb` and `colorMaxArgb`; null endpoints fall back to black / white
- [x] Settling state machine (per-binding):
  - [x] On retarget: snapshot current evaluated value (not raw input) as new `startValue`, set `targetValue` to mapped raw, record `startTsMs` from wall clock, copy `settlingMs` + `curve`
  - [x] Each frame, evaluate as `lerp(startValue, targetValue, applyEasing(curve, elapsed/settlingMs))` clamped to [0, 1]; once elapsed ≥ settlingMs, snap to target
  - [x] Color settling lerps ARGB; scalar settling lerps numbers
- [x] Wall clock:
  - [x] Separate `_wallClockMs` advanced unconditionally on every `advance(dtMs)` (continues during `pause()`)
  - [x] Used as "now" for binding settling
- [x] `advance(dtMs)` integration:
  - [x] Advance wall clock unconditionally
  - [x] Repaint condition becomes `isPlaying || anyBindingSettling || _bindingDirty`
  - [x] Clear `_bindingDirty` after notifying
- [x] Wire binding evaluation into `resolveAll()`: after base resolution + transition blending, override resolved element properties (`x, y, rotation, scaleX, scaleY, opacity, fillOverride, strokeOverride`) per binding

---

## Phase 7 — Canvas 2D Renderer

- [x] `AnimationRenderer` class (targets an HTML `<canvas>` element)
  - [x] Constructor: `new AnimationRenderer(canvas, controller, options?)` where `options = { boxFit?: BoxFit, warmUp?: boolean }`
  - [x] `boxFit: BoxFit` (default `'contain'`)
  - [x] `warmUp?: boolean` (default `true`): one synchronous `_paint()` call before the first RAF tick warms V8's JIT on all hot paint paths; set to `false` for short-lived canvases where the extra paint cost is not worth it
  - [x] `start()` / `stop()` — attach / detach `requestAnimationFrame` loop; per-frame: `controller.advance(dt)` then repaint
  - [x] Cap `dt` at 100ms to prevent fast-forward after backgrounded tabs
  - [x] Honour device pixel ratio: set `canvas.width = clientWidth * dpr`, scale context by `dpr`; `ResizeObserver` keeps the bitmap synced
- [x] Per-frame paint pipeline:
  - [x] Clear canvas (or fill with viewport `backgroundArgb` if non-null; otherwise transparent)
  - [x] Skip rendering if `viewport.width <= 0 || viewport.height <= 0`
  - [x] Apply `BoxFit` (translate + scale + translate(-vp.x, -vp.y)) — 7 modes:
    - [x] `contain` (default), `cover`, `fill`, `fitWidth`, `fitHeight`, `scaleDown`, `none`
  - [x] Clip to viewport rect `(vp.x, vp.y, vp.width, vp.height)`
  - [x] If `controller.transitionInFadeOpacity < 1`, multiply `globalAlpha` (Canvas 2D has no `saveLayer`; this is "good enough" for fade-in — overlapping shapes may differ slightly from Flutter)
  - [x] Recursive `paintNode(scene, ctx)`
- [x] `paintNode(node, ctx)` — exact order:
  1. [x] **Visibility short-circuit**: when `AnimatedElement.visible === false`, skip the entire subtree
  2. [x] **Clip mask** (in *parent* coord space, before this node's transforms): if `node.id` matches an `AnimatedElement` with non-null `clipMaskId`, look up mask via `sceneIndex`, build mask path with mask's animated + static transforms composed, `ctx.clip(maskPath)`
  3. [x] **Animated transform** (pivot-relative, only when `resolved[node.id]` exists):
     - [x] `ctx.translate(pivotX + x, pivotY + y)`
     - [x] `ctx.rotate(rotation * π / 180)`
     - [x] `ctx.scale(scaleX, scaleY)`
     - [x] `ctx.translate(-pivotX, -pivotY)`
  4. [x] **Static SVG transform** (`node.transform` — `ctx.transform(a,b,c,d,e,f)`)
  5. [x] **Opacity layer**:
     - [x] `effective = (resolved.opacity ?? 1) * node.opacity`
     - [x] If `effective <= 0`: skip entire subtree
     - [x] If `effective < 1`: stack `globalAlpha` (Canvas 2D fallback for `saveLayer`)
  6. [x] **Static clip-path** (`node.clipPath` — in this node's coord space)
  7. [x] **Draw geometry** (when `node.geometry` non-null):
     - [x] Bounds for `objectBoundingBox` gradients pre-computed at SVG parse time (`SceneNode.geometryBounds`) — exact for primitives, via hidden `<svg>.getBBox()` for `<path>`
     - [x] Fill source: `resolved.fillOverride` (as solid ARGB) overrides `node.fill`; otherwise use `node.fill`
     - [x] Stroke source: `resolved.strokeOverride` overrides `node.stroke`
     - [x] Skip stroke when `node.strokeWidth <= 0`
     - [x] Apply `node.strokeLinecap` and `node.strokeLinejoin`
  8. [x] **Children** via `paintChildren(children, ctx)` — re-sort by effective `zIndex` only when at least one child has a non-null resolved `zIndex` (otherwise document order)
  9. [x] Pop opacity layer, then restore parent transform
- [x] `<use>` node handling: tagName === `'use'`, no geometry — children walked with the use's transform applied (existing recursion handles it)
- [x] Paint resolution:
  - [x] `SolidPaint` → ARGB → CSS `rgba()` string for `ctx.fillStyle` / `strokeStyle`
  - [x] `LinearGradientPaint` → `ctx.createLinearGradient`. When `objectBoundingBox`, map endpoints from `(0..1, 0..1)` to `(bounds.left + x*w, bounds.top + y*h)`; pre-multiply endpoints by `gradientTransform` before creating the gradient
  - [x] `RadialGradientPaint` → `ctx.createRadialGradient(fx ?? cx, fy ?? cy, 0, cx, cy, r)`. When `objectBoundingBox`, map center/focal to bbox space; approximate radius as `max(w, h) * r`
  - [x] Add gradient stops in normalized `[0..1]` order
- [x] Skip drawing when `AnimatedElement.visible === false` (covered by step 1 — entire subtree)

---

## Phase 8 — Motion Paths (no-op, intentional)

Motion paths are pre-baked into x/y keyframes by the designer's
`exportProjectForRuntime` step (path is sampled at fps intervals and
flattened into translation values). The `.var.json` runtime format never
contains a `motionPathId`. The Flutter painter does not apply
`pathProgress` either — it's preserved in the data model only for
designer round-trips and bone-binding fall-throughs.

- [x] `pathProgress` is stored on `Keyframe` and `ResolvedElement` (Phase 1 + 3)
- [x] Resolver interpolates `pathProgress` like other nullable channels (Phase 3)
- No further runtime work needed — implementing path application here would
  diverge from the Flutter runtime's behaviour.

---

## Phase 9d — Group-rooted clip masks

- [x] `clipMaskId` referencing a `<g>` animated element clips against the union of descendant shapes (previously the runtime silently no-op'd because `maskNode.geometry` was null, leaving the masked element fully visible)
- [x] Empty mask subtrees return null and skip the clip rather than collapsing to "clip everything out"
- [x] Mirrored in the Flutter runtime; covered by Flutter unit tests on `buildMaskPath`

---

## Phase 9e — Closed-path dash cycle scaling

- [x] `PathGeometry` carries `length` and `closed` (computed analytically for primitives, via the existing hidden-SVG helper for `<path>` data)
- [x] `SceneNode` propagates `geometryLength` + `geometryClosed`
- [x] Renderer scales dasharray + offset by `geometryLength / (N × cycle)` for closed paths so Canvas's `setLineDash` tiles cleanly across the closure seam (`N = round(geometryLength / cycle)`). Open paths keep the literal pattern.
- [x] Mirrors the SVG `pathLength` trick in the designer/viewer and the equivalent dash-array scaling in the Flutter `dashPath`. Visual dash size shifts by typically <5 %.

---

## Phase 9c — Stroke dash-offset animation

- [x] `Keyframe.strokeDashOffset` (nullable) and `ResolvedElement.strokeDashOffset` channels
- [x] `'strokeDashOffset'` registered as a `BoundProperty` (scalar)
- [x] `SceneNode.strokeDashArray` / `strokeDashOffset` parsed from SVG and inherited through groups
- [x] Resolver lerps the new nullable channel (legacy + selective-`props` paths)
- [x] Controller routes the new bound property in `_applyBindings`
- [x] Renderer applies `setLineDash` + `lineDashOffset` (animated value when present, else static)
- [x] Re-exported from `src/index.ts` via the existing `BoundProperty` / `Keyframe` / `ResolvedElement` types

---

## Phase 9b — Exploration API

- [x] `StateInfo` / `DataBindingInfo` / `DataKeyInfo` types in `model/types.ts`
- [x] `VectorAnimateController.listStates()` — config + `isDefault` / `isCurrent` / `elementCount` per state
- [x] `VectorAnimateController.getStateInfo(name)` — single-state lookup
- [x] `VectorAnimateController.listBindings()` — every declared binding decorated with its owning element id
- [x] `VectorAnimateController.listDataKeys()` — bindings grouped per `dataKey` plus controller's current value
- [x] Player delegates: `listStates`, `getStateInfo`, `listBindings`, `listDataKeys`
- [x] Re-exported from `src/index.ts`

---

## Phase 9 — Public API & Events

- [x] Top-level export `VectorAnimatePlayer` (convenience wrapper around loader + controller + renderer):
  - [x] Static `VectorAnimatePlayer.create(canvas, source, options?)` async factory; `source` accepts `string` (URL), `Uint8Array`, `VectorAnimation`, or pre-decoded JSON object
  - [x] `options`: `{ initialState, mode, speed, autoplay, boxFit }`
  - [x] Delegates: `.play()`, `.pause()`, `.stop()`, `.seekTo(ms)`
  - [x] Delegates: `.setState(state)`, `.currentState`, `.position`, `.isPlaying`, `.isInTransition`
  - [x] Delegates: `.setData(key, value)`, `.setDataMap(map)`, `.clearData(key)`, `.getData(key)`
  - [x] Delegates: `.mode`, `.speed`, `.boxFit`
  - [x] Events: `.on('stateChange', handler)`, `.on('stateTransitionEnd', handler)` (return unsubscribe)
  - [x] `.dispose()` — stop RAF, dispose controller, release canvas references
- [x] All public types and functions re-exported from `src/index.ts` (done incrementally per phase)

---

## Phase 10 — Packaging & Build

- [x] Project structure: `src/` + `tsconfig.json` (Phase 1)
- [x] Build tooling (`tsup` — single config, esbuild-powered):
  - [x] ESM output (`dist/index.js`)
  - [x] CJS output (`dist/index.cjs`)
  - [x] IIFE output for `<script>` tag usage (`dist/index.iife.js`, global `VectorAnimateWeb`)
  - [x] TypeScript declarations (`dist/index.d.ts` + `dist/index.d.cts`) auto-emitted
- [x] `package.json` with `exports`, `main`, `module`, `types` fields, `sideEffects: false`, `files: ['dist', 'src']`
- [x] Zero runtime dependencies — gzip via native `DecompressionStream` (already wired)
- [x] Unit tests (`vitest` — 76 tests passing in ~200ms):
  - [x] Easing functions (boundary values, named curve identities, overshoot/oscillation behaviour)
  - [x] Keyframe interpolation (legacy fast path, per-channel slow path, mixed legacy + selective)
  - [x] Data binding (`mapScalar`, `mapColor`, `argbLerp`, `isColorProperty`)
  - [x] CSS color parsing (#RGB, #RRGGBB, #RRGGBBAA, none/transparent/empty fallbacks)
  - [x] Matrix2D multiplication + identity (right-to-left composition order)
- [x] Integration test: end-to-end loader → controller → resolveAll, including state-transition blending and data-binding overrides (uses empty `svgRaw` to avoid the DOM dependency in Node)

---

## Feature Parity Checklist

| Feature | Flutter | Web |
|---|---|---|
| `.var.json` loading | ✓ | ✓ |
| `.var` binary (gzip) loading | ✓ | ✓ |
| SVG scene graph parsing | ✓ | ✓ |
| Transform animation (x, y, rot, scale, opacity) | ✓ | ✓ |
| Per-channel keyframe narrowing (`props`) | ✓ | ✓ |
| Z-order animation (`zIndex`) | ✓ | ✓ |
| Motion-path (`pathProgress`) | stored only | stored only (baked at export) |
| 10 easing curves | ✓ | ✓ |
| Playback modes (loop / oneShot / pingPong) | ✓ | ✓ |
| Speed multiplier | ✓ | ✓ |
| seek / play / pause / stop | ✓ | ✓ |
| State machine (`setState`) | ✓ | ✓ |
| State transition blending | ✓ | ✓ |
| Per-element transition overrides | ✓ | ✓ |
| TransitionIn: animate type | ✓ | ✓ |
| TransitionIn: fade type | ✓ | ✓ |
| Data bindings — scalar | ✓ | ✓ |
| Data bindings — color | ✓ | ✓ |
| Data binding settling | ✓ | ✓ |
| Canvas rendering pipeline | ✓ | ✓ |
| BoxFit scaling (7 modes) | ✓ | ✓ |
| Solid paint | ✓ | ✓ |
| Linear gradient | ✓ | ✓ |
| Radial gradient | ✓ | ✓ |
| Clip masks (`clipMaskId`) | ✓ | ✓ |
| Static clip-path | ✓ | ✓ |
| Pivot-relative transforms | ✓ | ✓ |
| Opacity compositing | ✓ | ✓ |
| Stroke styles (cap / join) | ✓ | ✓ |
| onStateChange event | ✓ | ✓ |
| onStateTransitionEnd event | ✓ | ✓ |
| ESM / CJS / IIFE packages | N/A | ✓ |
| Warm-up (pre-render first frame, V8 JIT) | N/A | ✓ |
