import { describe, expect, it } from 'vitest';
import { VarLoader } from '../src/loader/loader.js';
import { VectorAnimateController } from '../src/engine/controller.js';

/**
 * End-to-end test of the loader → controller → resolveAll path. Uses an
 * empty `svgRaw` to avoid the SVG parser (which needs a DOM); the data-flow
 * paths exercised here cover keyframe interpolation, state transitions, and
 * data-binding overrides.
 */
const FIXTURE = {
  name: 'test',
  fps: 60,
  svgRaw: '',
  viewport: { x: 0, y: 0, width: 100, height: 100, background: '#000000' },
  states: ['idle', 'hover'],
  defaultState: 'idle',
  stateConfigs: {
    idle:  { duration: 1000, windowIn: 0, windowOut: 1000, transitionIn: { type: 'animate', duration: 300 } },
    hover: { duration: 1000, windowIn: 0, windowOut: 1000, transitionIn: { type: 'animate', duration: 300 } },
  },
  stateTransitions: [],
  defaultTransition: { duration: 300, curve: 'linear' },
  elements: {
    el1: {
      tagName: 'rect',
      pivotX: 50, pivotY: 50, visible: true,
      animations: {
        idle: {
          keyframes: [
            { id: 'k1', time: 0,    x: 0,   y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, curve: 'linear' },
            { id: 'k2', time: 1000, x: 100, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, curve: 'linear' },
          ],
        },
        hover: {
          keyframes: [
            { id: 'k3', time: 0, x: 0, y: 50, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, curve: 'linear' },
          ],
        },
      },
      dataBindings: [
        {
          id: 'b1', property: 'opacity', dataKey: 'alpha',
          settlingMs: 0, curve: 'linear',
          inMin: 0, inMax: 1, outMin: 0, outMax: 1,
        },
      ],
    },
  },
  elementOrder: ['el1'],
};

describe('VarLoader.fromJson + VectorAnimateController', () => {
  it('parses a runtime-only JSON document', () => {
    const animation = VarLoader.fromJson(FIXTURE);
    expect(animation.name).toBe('test');
    expect(animation.fps).toBe(60);
    expect(animation.states).toEqual(['idle', 'hover']);
    expect(animation.elements['el1']).toBeDefined();
    expect(animation.elements['el1']!.dataBindings).toHaveLength(1);
  });

  it('resolves keyframe poses across the timeline', () => {
    const animation = VarLoader.fromJson(FIXTURE);
    const c = new VectorAnimateController(animation, { autoplay: false });

    const at = (ms: number): number => {
      c.seekTo(ms);
      return c.resolveAll().get('el1')!.x;
    };

    expect(at(0)).toBeCloseTo(0,   6);
    expect(at(250)).toBeCloseTo(25,  6);
    expect(at(500)).toBeCloseTo(50,  6);
    expect(at(750)).toBeCloseTo(75,  6);
    expect(at(1000)).toBeCloseTo(100, 6);
  });

  it('snapshots current pose and blends through a state transition', () => {
    const animation = VarLoader.fromJson(FIXTURE);
    const c = new VectorAnimateController(animation, { autoplay: false });

    c.seekTo(500);                           // x = 50 in idle
    expect(c.resolveAll().get('el1')!.x).toBeCloseTo(50, 6);

    c.setState('hover');                     // snapshot pose at x=50, target hover.k3 (x=0, y=50)
    expect(c.isInTransition).toBe(true);
    expect(c.currentState).toBe('hover');

    // Just-after-setState (transition elapsed = 0): pose equals snapshot.
    const r0 = c.resolveAll().get('el1')!;
    expect(r0.x).toBeCloseTo(50, 6);
    expect(r0.y).toBeCloseTo(0,  6);

    // Drive the transition forward 150ms (half of 300ms) — linear default curve.
    // Manually invoke advance with autoplay-equivalent behavior.
    c.play();
    c.advance(150);
    const rMid = c.resolveAll().get('el1')!;
    expect(rMid.x).toBeCloseTo(25, 1);     // 50 → 0, halfway = 25
    expect(rMid.y).toBeCloseTo(25, 1);     // 0  → 50, halfway = 25

    // Complete the transition.
    c.advance(150);
    expect(c.isInTransition).toBe(false);
    const rEnd = c.resolveAll().get('el1')!;
    expect(rEnd.x).toBeCloseTo(0,  6);
    expect(rEnd.y).toBeCloseTo(50, 6);
  });

  it('applies scalar data-binding overrides to resolved poses', () => {
    const animation = VarLoader.fromJson(FIXTURE);
    const c = new VectorAnimateController(animation, { autoplay: false });

    expect(c.resolveAll().get('el1')!.opacity).toBe(1);

    c.setData('alpha', 0.25);
    expect(c.resolveAll().get('el1')!.opacity).toBeCloseTo(0.25, 6);

    c.setData('alpha', 0.0);
    expect(c.resolveAll().get('el1')!.opacity).toBeCloseTo(0.0, 6);

    c.clearData('alpha');
    expect(c.resolveAll().get('el1')!.opacity).toBe(1);
  });

  it('declaredDataKeys lists all binding keys regardless of whether set', () => {
    const animation = VarLoader.fromJson(FIXTURE);
    const c = new VectorAnimateController(animation, { autoplay: false });
    expect(c.declaredDataKeys).toEqual(new Set(['alpha']));
  });

  it('throws on unknown setState', () => {
    const animation = VarLoader.fromJson(FIXTURE);
    const c = new VectorAnimateController(animation, { autoplay: false });
    expect(() => c.setState('does-not-exist')).toThrow(/unknown state/);
  });
});

describe('stroke-dash animation', () => {
  const DASH_FIXTURE = {
    name: 't',
    fps: 60,
    svgRaw: '',
    viewport: { x: 0, y: 0, width: 10, height: 10, background: 'transparent' },
    states: ['a'],
    defaultState: 'a',
    stateConfigs: { a: { duration: 1000, windowIn: 0, windowOut: 1000 } },
    defaultTransition: { duration: 1, curve: 'linear' },
    stateTransitions: [],
    elements: {
      el: {
        tagName: 'path',
        pivotX: 0, pivotY: 0, visible: true,
        animations: {
          a: {
            keyframes: [
              { id: 'k1', time: 0,    x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, strokeDashOffset: 0,  curve: 'linear' },
              { id: 'k2', time: 1000, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, strokeDashOffset: 40, curve: 'linear' },
            ],
          },
        },
        dataBindings: [
          {
            id: 'b1', property: 'strokeDashOffset', dataKey: 'flow',
            settlingMs: 0, curve: 'linear',
            inMin: 0, inMax: 1, outMin: 0, outMax: 100,
          },
        ],
      },
    },
    elementOrder: ['el'],
  };

  it('interpolates strokeDashOffset across keyframes', () => {
    const animation = VarLoader.fromJson(DASH_FIXTURE);
    const c = new VectorAnimateController(animation, { autoplay: false });
    c.seekTo(0);
    expect(c.resolveAll().get('el')!.strokeDashOffset).toBeCloseTo(0, 6);
    c.seekTo(500);
    expect(c.resolveAll().get('el')!.strokeDashOffset).toBeCloseTo(20, 6);
    c.seekTo(1000);
    expect(c.resolveAll().get('el')!.strokeDashOffset).toBeCloseTo(40, 6);
  });

  it('null strokeDashOffset on every keyframe leaves the resolved value null', () => {
    const fixture = JSON.parse(JSON.stringify(DASH_FIXTURE));
    for (const kf of fixture.elements.el.animations.a.keyframes) {
      delete kf.strokeDashOffset;
    }
    const animation = VarLoader.fromJson(fixture);
    const c = new VectorAnimateController(animation, { autoplay: false });
    c.seekTo(500);
    expect(c.resolveAll().get('el')!.strokeDashOffset).toBeNull();
  });

  it('strokeDashOffset data binding overrides the resolved value', () => {
    const animation = VarLoader.fromJson(DASH_FIXTURE);
    const c = new VectorAnimateController(animation, { autoplay: false });
    c.seekTo(0);
    c.setData('flow', 0.5);
    expect(c.resolveAll().get('el')!.strokeDashOffset).toBeCloseTo(50, 6);
    c.clearData('flow');
    expect(c.resolveAll().get('el')!.strokeDashOffset).toBeCloseTo(0, 6);
  });
});

describe('exploration API', () => {
  it('listStates returns one entry per declared state with config + flags', () => {
    const animation = VarLoader.fromJson(FIXTURE);
    const c = new VectorAnimateController(animation, { autoplay: false });
    const states = c.listStates();
    expect(states.map(s => s.name)).toEqual(['idle', 'hover']);

    const idle = states[0]!;
    expect(idle.duration).toBe(1000);
    expect(idle.windowIn).toBe(0);
    expect(idle.windowOut).toBe(1000);
    expect(idle.transitionInType).toBe('animate');
    expect(idle.transitionInDuration).toBe(300);
    expect(idle.isDefault).toBe(true);
    expect(idle.isCurrent).toBe(true);
    expect(idle.elementCount).toBe(1);

    const hover = states[1]!;
    expect(hover.isDefault).toBe(false);
    expect(hover.isCurrent).toBe(false);

    c.setState('hover');
    const after = c.listStates();
    expect(after[0]!.isCurrent).toBe(false);
    expect(after[1]!.isCurrent).toBe(true);
  });

  it('getStateInfo returns undefined for unknown names', () => {
    const animation = VarLoader.fromJson(FIXTURE);
    const c = new VectorAnimateController(animation, { autoplay: false });
    expect(c.getStateInfo('idle')?.name).toBe('idle');
    expect(c.getStateInfo('nope')).toBeUndefined();
  });

  it('listBindings reports each declared binding with its owning element id', () => {
    const animation = VarLoader.fromJson(FIXTURE);
    const c = new VectorAnimateController(animation, { autoplay: false });
    const bindings = c.listBindings();
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({
      id: 'b1',
      elementId: 'el1',
      dataKey: 'alpha',
      property: 'opacity',
      isColor: false,
      inMin: 0,
      inMax: 1,
      outMin: 0,
      outMax: 1,
      settlingMs: 0,
      curve: 'linear',
    });
  });

  it('listDataKeys groups bindings and reflects setData / clearData', () => {
    const animation = VarLoader.fromJson(FIXTURE);
    const c = new VectorAnimateController(animation, { autoplay: false });

    let keys = c.listDataKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0]!.dataKey).toBe('alpha');
    expect(keys[0]!.bindings).toHaveLength(1);
    expect(keys[0]!.bindings[0]!.id).toBe('b1');
    expect(keys[0]!.isSet).toBe(false);
    expect(keys[0]!.currentValue).toBeUndefined();

    c.setData('alpha', 0.4);
    keys = c.listDataKeys();
    expect(keys[0]!.isSet).toBe(true);
    expect(keys[0]!.currentValue).toBe(0.4);

    c.clearData('alpha');
    keys = c.listDataKeys();
    expect(keys[0]!.isSet).toBe(false);
    expect(keys[0]!.currentValue).toBeUndefined();
  });
});
