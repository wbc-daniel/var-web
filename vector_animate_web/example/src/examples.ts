import type { PlayerSource } from 'vector-animate-web';
import sampleVarUrl from '../sample.var?url';

/**
 * Each example is either a hand-built `.var.json` document or a URL pointing
 * at a real `.var` / `.var.json` fixture. `VectorAnimatePlayer.create`
 * accepts both forms transparently.
 *
 * The optional `kind: 'upload'` slot is a UI-only sentinel — `App.vue` shows
 * a drop zone for it instead of auto-loading. Once the user picks a file,
 * the source is replaced with the file's bytes and the demo plays normally.
 */
export interface ExampleAnimation {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly source: PlayerSource | null;
  readonly kind?: 'upload';
}

// ── 1. Bouncing box ──────────────────────────────────────────────────────────

const BOUNCING_BOX: ExampleAnimation = {
  id: 'bouncing-box',
  name: 'Bouncing Box',
  description:
    'A square that jumps, squashes on impact, and spins back to rest. Try the playback mode dropdown to see loop, oneShot, and pingPong behaviour.',
  source: {
    name: 'Bouncing Box',
    fps: 60,
    svgRaw: `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <rect id="shadow" x="60" y="170" width="80" height="8" rx="4" fill="#cbd5e1"/>
      <rect id="box" x="70" y="120" width="60" height="60" rx="8" fill="#3b82f6"/>
    </svg>`,
    viewport: { x: 0, y: 0, width: 200, height: 200, background: '#f8fafc' },
    states: ['idle'],
    defaultState: 'idle',
    stateConfigs: {
      idle: {
        duration: 1600, windowIn: 0, windowOut: 1600,
        transitionIn: { type: 'animate', duration: 0 },
      },
    },
    stateTransitions: [],
    defaultTransition: { duration: 300, curve: 'ease-in-out' },
    elements: {
      box: {
        tagName: 'rect',
        pivotX: 100, pivotY: 150,
        visible: true,
        animations: {
          idle: {
            keyframes: [
              kf(0, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, curve: 'ease-out' }),
              kf(500, { x: 0, y: -90, rotation: 180, scaleX: 1, scaleY: 1, curve: 'ease-in' }),
              kf(700, { x: 0, y: 0, rotation: 270, scaleX: 1.4, scaleY: 0.6, curve: 'ease-out' }),
              kf(900, { x: 0, y: 0, rotation: 270, scaleX: 1, scaleY: 1, curve: 'bounce-out' }),
              kf(1600, { x: 0, y: 0, rotation: 360, scaleX: 1, scaleY: 1, curve: 'linear' }),
            ],
          },
        },
        dataBindings: [],
      },
      shadow: {
        tagName: 'rect',
        pivotX: 100, pivotY: 174,
        visible: true,
        animations: {
          idle: {
            keyframes: [
              kf(0, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 0.6, curve: 'ease-out' }),
              kf(500, { x: 0, y: 0, rotation: 0, scaleX: 0.5, scaleY: 1, opacity: 0.2, curve: 'ease-in' }),
              kf(700, { x: 0, y: 0, rotation: 0, scaleX: 1.3, scaleY: 1, opacity: 0.7, curve: 'ease-out' }),
              kf(1600, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 0.6, curve: 'linear' }),
            ],
          },
        },
        dataBindings: [],
      },
    },
    elementOrder: ['shadow', 'box'],
  },
};

// ── 2. State machine ─────────────────────────────────────────────────────────

const STATE_MACHINE: ExampleAnimation = {
  id: 'state-machine',
  name: 'State Machine',
  description:
    'Three states with distinct animations. Click a state button to trigger a smooth transition — the runtime snapshots the current pose and blends it toward the new state\'s keyframes.',
  source: {
    name: 'State Machine',
    fps: 60,
    svgRaw: `<svg viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg">
      <ellipse id="shadow" cx="150" cy="260" rx="60" ry="8" fill="#cbd5e1"/>
      <circle id="body" cx="150" cy="200" r="50" fill="#10b981"/>
      <circle id="head" cx="150" cy="120" r="36" fill="#34d399"/>
      <circle id="eye-l" cx="138" cy="118" r="5" fill="#0f172a"/>
      <circle id="eye-r" cx="162" cy="118" r="5" fill="#0f172a"/>
    </svg>`,
    viewport: { x: 0, y: 0, width: 300, height: 300, background: '#f8fafc' },
    states: ['idle', 'hover', 'jump'],
    defaultState: 'idle',
    stateConfigs: {
      idle: config(2400, { type: 'animate', duration: 400 }),
      hover: config(1200, { type: 'animate', duration: 250 }),
      jump: config(800, { type: 'animate', duration: 200 }),
    },
    stateTransitions: [],
    defaultTransition: { duration: 350, curve: 'ease-in-out' },
    elements: {
      body: animatedEl(150, 200, {
        idle: [
          kf(0, { x: 0, y: 0, scaleX: 1, scaleY: 1, curve: 'ease-in-out' }),
          kf(1200, { x: 0, y: 4, scaleX: 1.04, scaleY: 0.96, curve: 'ease-in-out' }),
          kf(2400, { x: 0, y: 0, scaleX: 1, scaleY: 1, curve: 'ease-in-out' }),
        ],
        hover: [
          kf(0, { x: 0, y: -12, scaleX: 1.05, scaleY: 1.05, curve: 'ease-out' }),
          kf(600, { x: 0, y: -16, scaleX: 1.05, scaleY: 1.05, curve: 'ease-in-out' }),
          kf(1200, { x: 0, y: -12, scaleX: 1.05, scaleY: 1.05, curve: 'ease-in-out' }),
        ],
        jump: [
          kf(0, { x: 0, y: 10, scaleX: 1.2, scaleY: 0.8, curve: 'ease-out' }),
          kf(200, { x: 0, y: -60, scaleX: 0.9, scaleY: 1.1, curve: 'ease-out' }),
          kf(500, { x: 0, y: -60, scaleX: 0.9, scaleY: 1.1, curve: 'ease-in' }),
          kf(800, { x: 0, y: 0, scaleX: 1, scaleY: 1, curve: 'bounce-out' }),
        ],
      }),
      head: animatedEl(150, 120, {
        idle: [
          kf(0, { x: 0, y: 0, rotation: -3, scaleX: 1, scaleY: 1, curve: 'ease-in-out' }),
          kf(1200, { x: 0, y: -2, rotation: 3, scaleX: 1, scaleY: 1, curve: 'ease-in-out' }),
          kf(2400, { x: 0, y: 0, rotation: -3, scaleX: 1, scaleY: 1, curve: 'ease-in-out' }),
        ],
        hover: [
          kf(0, { x: 0, y: -16, rotation: 0, scaleX: 1.1, scaleY: 1.1, curve: 'ease-out' }),
          kf(600, { x: 0, y: -22, rotation: 0, scaleX: 1.1, scaleY: 1.1, curve: 'ease-in-out' }),
          kf(1200, { x: 0, y: -16, rotation: 0, scaleX: 1.1, scaleY: 1.1, curve: 'ease-in-out' }),
        ],
        jump: [
          kf(0, { x: 0, y: 8, rotation: 0, scaleX: 1, scaleY: 1, curve: 'ease-out' }),
          kf(200, { x: 0, y: -70, rotation: 0, scaleX: 1, scaleY: 1, curve: 'ease-out' }),
          kf(500, { x: 0, y: -70, rotation: 0, scaleX: 1, scaleY: 1, curve: 'ease-in' }),
          kf(800, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, curve: 'bounce-out' }),
        ],
      }),
      'eye-l': eyeLikeBody('idle', -12),
      'eye-r': eyeLikeBody('idle', 12),
      shadow: animatedEl(150, 260, {
        idle: [kf(0, { scaleX: 1, opacity: 0.5 }), kf(2400, { scaleX: 1, opacity: 0.5 })],
        hover: [kf(0, { scaleX: 0.8, opacity: 0.3 }), kf(1200, { scaleX: 0.8, opacity: 0.3 })],
        jump: [
          kf(0, { scaleX: 1.1, opacity: 0.5 }),
          kf(200, { scaleX: 0.4, opacity: 0.15 }),
          kf(500, { scaleX: 0.4, opacity: 0.15 }),
          kf(800, { scaleX: 1.1, opacity: 0.6 }),
        ],
      }),
    },
    elementOrder: ['shadow', 'body', 'head', 'eye-l', 'eye-r'],
  },
};

// Helper: tiny eye that follows the head's translation, no rotation. Reuses
// head-like keyframes for `idle` so the eye sits with the head.
function eyeLikeBody(_state: string, dx: number) {
  return animatedEl(150 + dx, 118, {
    idle: [
      kf(0, { x: 0, y: 0, scaleX: 1, scaleY: 1, curve: 'ease-in-out' }),
      kf(1200, { x: 0, y: -2, scaleX: 1, scaleY: 1, curve: 'ease-in-out' }),
      kf(2400, { x: 0, y: 0, scaleX: 1, scaleY: 1, curve: 'ease-in-out' }),
    ],
    hover: [
      kf(0, { x: 0, y: -16, scaleX: 1.1, scaleY: 0.6, curve: 'ease-out' }),
      kf(600, { x: 0, y: -22, scaleX: 1.1, scaleY: 0.6, curve: 'ease-in-out' }),
      kf(1200, { x: 0, y: -16, scaleX: 1.1, scaleY: 0.6, curve: 'ease-in-out' }),
    ],
    jump: [
      kf(0, { x: 0, y: 8, scaleX: 1, scaleY: 1, curve: 'ease-out' }),
      kf(200, { x: 0, y: -70, scaleX: 1, scaleY: 1, curve: 'ease-out' }),
      kf(500, { x: 0, y: -70, scaleX: 1, scaleY: 1, curve: 'ease-in' }),
      kf(800, { x: 0, y: 0, scaleX: 1, scaleY: 1, curve: 'bounce-out' }),
    ],
  });
}

// ── 3. Data bindings ─────────────────────────────────────────────────────────

const DATA_BINDINGS: ExampleAnimation = {
  id: 'data-bindings',
  name: 'Data Bindings',
  description:
    'Drag the sliders to drive the animation in real-time. Each slider sets a data key; bindings remap that scalar onto a transform or color property and settle to the new target over a configurable duration.',
  source: {
    name: 'Data Bindings',
    fps: 60,
    svgRaw: `<svg viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg">
      <rect id="track" x="40" y="180" width="220" height="6" rx="3" fill="#e2e8f0"/>
      <circle id="dot" cx="150" cy="120" r="40" fill="#3b82f6" stroke="#1e293b" stroke-width="3"/>
    </svg>`,
    viewport: { x: 0, y: 0, width: 300, height: 300, background: '#f8fafc' },
    states: ['idle'],
    defaultState: 'idle',
    stateConfigs: {
      idle: { duration: 100, windowIn: 0, windowOut: 100, transitionIn: { type: 'animate', duration: 0 } },
    },
    stateTransitions: [],
    defaultTransition: { duration: 0, curve: 'linear' },
    elements: {
      dot: {
        tagName: 'circle',
        pivotX: 150, pivotY: 120,
        visible: true,
        animations: {
          idle: { keyframes: [kf(0, {})] },
        },
        dataBindings: [
          {
            id: 'b-x', property: 'x', dataKey: 'xPos',
            settlingMs: 250, curve: 'ease-out',
            inMin: 0, inMax: 1, outMin: -100, outMax: 100,
          },
          {
            id: 'b-y', property: 'y', dataKey: 'yPos',
            settlingMs: 250, curve: 'ease-out',
            inMin: 0, inMax: 1, outMin: -60, outMax: 60,
          },
          {
            id: 'b-scale', property: 'scaleX', dataKey: 'size',
            settlingMs: 200, curve: 'ease-out',
            inMin: 0, inMax: 1, outMin: 0.5, outMax: 1.6,
          },
          {
            id: 'b-scaleY', property: 'scaleY', dataKey: 'size',
            settlingMs: 200, curve: 'ease-out',
            inMin: 0, inMax: 1, outMin: 0.5, outMax: 1.6,
          },
          {
            id: 'b-opacity', property: 'opacity', dataKey: 'alpha',
            settlingMs: 100, curve: 'linear',
            inMin: 0, inMax: 1, outMin: 0.2, outMax: 1,
          },
          {
            id: 'b-fill', property: 'fill', dataKey: 'hue',
            settlingMs: 400, curve: 'ease-in-out',
            inMin: 0, inMax: 1, outMin: 0, outMax: 1,
            colorMin: '#ef4444', colorMax: '#3b82f6',
          },
          {
            id: 'b-stroke', property: 'stroke', dataKey: 'hue',
            settlingMs: 400, curve: 'ease-in-out',
            inMin: 0, inMax: 1, outMin: 0, outMax: 1,
            colorMin: '#7f1d1d', colorMax: '#1e3a8a',
          },
        ],
      },
    },
    elementOrder: ['track', 'dot'],
  },
};

// ── 4. Z-order swap ──────────────────────────────────────────────────────────

const Z_ORDER: ExampleAnimation = {
  id: 'z-order',
  name: 'Z-Order Animation',
  description:
    'Three overlapping disks animate their `zIndex` channel so the painter re-sorts them mid-flight. Only the disk that wants the front spot needs a non-null zIndex; the others fall back to their natural order.',
  source: {
    name: 'Z-Order',
    fps: 60,
    svgRaw: `<svg viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg">
      <g>
        <circle id="red"   cx="150" cy="150" r="60" fill="#ef4444"/>
        <circle id="green" cx="150" cy="150" r="60" fill="#10b981"/>
        <circle id="blue"  cx="150" cy="150" r="60" fill="#3b82f6"/>
      </g>
    </svg>`,
    viewport: { x: 0, y: 0, width: 300, height: 300, background: '#f8fafc' },
    states: ['idle'],
    defaultState: 'idle',
    stateConfigs: {
      idle: { duration: 3000, windowIn: 0, windowOut: 3000, transitionIn: { type: 'animate', duration: 0 } },
    },
    stateTransitions: [],
    defaultTransition: { duration: 0, curve: 'linear' },
    elements: {
      red: zOrbit(0, [0, 1000, 2000, 3000]),
      green: zOrbit(120, [0, 1000, 2000, 3000]),
      blue: zOrbit(240, [0, 1000, 2000, 3000]),
    },
    elementOrder: ['red', 'green', 'blue'],
  },
};

function zOrbit(phaseDeg: number, times: number[]) {
  const radius = 50;
  const phase = (phaseDeg * Math.PI) / 180;
  // Keyframes: each disk traces a circle. zIndex is set to 10 only when the
  // disk crosses behind the centre line (sin > 0 → the disk is at the bottom
  // half visually, where it should appear in front).
  const keyframes = times.map((t, i) => {
    const a = phase + (t / 3000) * Math.PI * 2;
    const x = Math.cos(a) * radius;
    const y = Math.sin(a) * radius;
    // zIndex flips ahead of the others when sin(a) > 0 (front half).
    const zIndex = Math.sin(a) > 0 ? 10 : null;
    return kf(t, { x, y, curve: i === times.length - 1 ? 'linear' : 'linear', zIndex });
  });
  return {
    tagName: 'circle',
    pivotX: 150, pivotY: 150,
    visible: true,
    animations: { idle: { keyframes } },
    dataBindings: [],
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function kf(time: number, vals: Partial<Keyframe> = {}): Keyframe {
  return {
    id: `k${time}`,
    time,
    x: vals.x ?? 0,
    y: vals.y ?? 0,
    rotation: vals.rotation ?? 0,
    scaleX: vals.scaleX ?? 1,
    scaleY: vals.scaleY ?? 1,
    opacity: vals.opacity ?? 1,
    curve: vals.curve ?? 'linear',
    ...(vals.zIndex !== undefined ? { zIndex: vals.zIndex } : {}),
  };
}

interface Keyframe {
  id: string;
  time: number;
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  curve: string;
  zIndex?: number | null;
}

function animatedEl(
  pivotX: number,
  pivotY: number,
  animations: Record<string, Keyframe[]>,
) {
  const out: Record<string, { keyframes: Keyframe[] }> = {};
  for (const [name, keyframes] of Object.entries(animations)) out[name] = { keyframes };
  return {
    tagName: 'circle',
    pivotX, pivotY,
    visible: true,
    animations: out,
    dataBindings: [],
  };
}

function config(duration: number, transitionIn: { type: 'animate' | 'fade'; duration: number }) {
  return { duration, windowIn: 0, windowOut: duration, transitionIn };
}

// ── 5. sample.var (binary fixture) ───────────────────────────────────────────

const SAMPLE_VAR: ExampleAnimation = {
  id: 'sample',
  name: 'sample.var',
  description:
    'A binary .var fixture loaded over the network. The runtime fetches the bytes, detects the VAB\\x01 header, gunzips with the native DecompressionStream, and parses the JSON. State buttons and data sliders below auto-populate from whatever the file declares.',
  source: sampleVarUrl,
};

// ── 6. Upload slot ───────────────────────────────────────────────────────────

const UPLOAD_SLOT: ExampleAnimation = {
  id: 'upload',
  name: 'Load file…',
  description:
    'Pick a `.var` (binary) or `.var.json` file from disk to play it through the runtime. Useful for testing exports from the editor without rebuilding the example bundle.',
  source: null,
  kind: 'upload',
};

// ── Registry ─────────────────────────────────────────────────────────────────

export const examples: ExampleAnimation[] = [
  UPLOAD_SLOT,
  SAMPLE_VAR,
  BOUNCING_BOX,
  STATE_MACHINE,
  DATA_BINDINGS,
  Z_ORDER,
];
