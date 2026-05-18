<template>
  <div class="demo">
    <header>
      <h2>{{ loadedName ?? example.name }}</h2>
      <p>{{ example.description }}</p>
    </header>

    <!-- Upload drop zone: only shown for the `upload` slot before a file is
         picked. Once `userSource` is set the regular canvas/controls take
         over so the demo behaves like any other example. -->
    <div
      v-if="example.kind === 'upload' && !userSource"
      class="drop-zone"
      :class="{ 'drop-zone--hover': dropHover, 'drop-zone--error': loadError }"
      @dragover.prevent="dropHover = true"
      @dragleave.prevent="dropHover = false"
      @drop.prevent="onDrop"
      @click="fileInput?.click()"
    >
      <input
        ref="fileInput"
        type="file"
        accept=".var,.var.json,.json,application/json"
        style="display:none"
        @change="onFilePicked"
      />
      <strong>Drop a .var or .var.json here</strong>
      <span class="hint">or click to browse</span>
      <span v-if="loadError" class="error">{{ loadError }}</span>
    </div>

    <div v-else class="canvas-wrap">
      <canvas ref="canvasEl" />
      <button
        v-if="example.kind === 'upload' && userSource"
        class="btn change-file"
        @click.stop="clearLoadedFile"
        title="Load a different file"
      >Change file</button>
    </div>

    <div class="controls" v-if="player">
      <!-- playback row -->
      <div class="row">
        <span class="label">Playback</span>
        <button class="btn" @click="player.play()" :disabled="player.isPlaying">▶ Play</button>
        <button class="btn" @click="player.pause()" :disabled="!player.isPlaying">⏸ Pause</button>
        <button class="btn" @click="player.stop()">⏹ Stop</button>
        <select v-model="mode" @change="onMode">
          <option value="loop">loop</option>
          <option value="oneShot">oneShot</option>
          <option value="pingPong">pingPong</option>
        </select>
      </div>

      <!-- speed -->
      <div class="row">
        <span class="label">Speed</span>
        <div class="slider">
          <span class="name">multiplier</span>
          <input type="range" min="0.1" max="3" step="0.1" v-model.number="speed" @input="onSpeed" />
          <span class="val">{{ speed.toFixed(2) }}x</span>
        </div>
      </div>

      <!-- box fit -->
      <div class="row">
        <span class="label">Fit</span>
        <select v-model="boxFit" @change="onBoxFit">
          <option value="contain">contain</option>
          <option value="cover">cover</option>
          <option value="fill">fill</option>
          <option value="fitWidth">fitWidth</option>
          <option value="fitHeight">fitHeight</option>
          <option value="scaleDown">scaleDown</option>
          <option value="none">none</option>
        </select>
      </div>

      <!-- states (only when more than one) -->
      <div class="row" v-if="states.length > 1">
        <span class="label">State</span>
        <button
          v-for="s in states"
          :key="s"
          class="btn"
          :class="{ active: s === currentState }"
          @click="player.setState(s)"
        >
          {{ s }}
        </button>
        <span v-if="isInTransition" class="val" style="color:#3b82f6">transitioning…</span>
      </div>

      <!-- data bindings -->
      <div class="row" v-if="dataKeys.length" style="flex-direction: column; align-items: stretch;">
        <span class="label">Data</span>
        <div class="slider" v-for="key in dataKeys" :key="key">
          <span class="name">{{ key }}</span>
          <input
            type="range" min="0" max="1" step="0.01"
            :value="dataValues[key] ?? 0.5"
            @input="onData(key, $event)"
          />
          <span class="val">{{ (dataValues[key] ?? 0.5).toFixed(2) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import {
  VectorAnimatePlayer,
  type BoxFit,
  type PlaybackMode,
  type PlayerSource,
} from 'vector-animate-web';
import type { ExampleAnimation } from './examples';

const props = defineProps<{ example: ExampleAnimation }>();

const canvasEl = ref<HTMLCanvasElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

// Strip the readonly so the template can call methods on the reactive proxy.
const player = ref<VectorAnimatePlayer | null>(null);

const mode = ref<PlaybackMode>('loop');
const speed = ref(1.0);
const boxFit = ref<BoxFit>('contain');

const currentState = ref('');
const isInTransition = ref(false);
const states = ref<readonly string[]>([]);

const dataKeys = ref<string[]>([]);
const dataValues = reactive<Record<string, number>>({});

// Upload-slot state. `userSource` becomes a Uint8Array once a file is picked;
// `loadedName` shows in the header so the user can tell which file they're
// looking at. Errors during decode surface inline next to the drop zone.
const userSource = ref<PlayerSource | null>(null);
const loadedName = ref<string | null>(null);
const dropHover = ref(false);
const loadError = ref<string | null>(null);

let unsubStateChange: (() => void) | undefined;
let unsubStateEnd: (() => void) | undefined;
let unsubListener: (() => void) | undefined;
let unmounted = false;

async function buildPlayer(source: PlayerSource): Promise<void> {
  if (!canvasEl.value) return;
  // Tear down any existing player before mounting a new one — the change-file
  // button reaches this path with a live player to replace.
  player.value?.dispose();
  player.value = null;

  const p = await VectorAnimatePlayer.create(canvasEl.value, source, {
    mode:    mode.value,
    speed:   speed.value,
    boxFit:  boxFit.value,
  });

  if (unmounted) { p.dispose(); return; }

  player.value = p;
  states.value = p.animation.states;
  currentState.value = p.currentState;

  // Initialise data sliders to the midpoint of each declared key.
  dataKeys.value = [...p.declaredDataKeys];
  for (const key of dataKeys.value) {
    dataValues[key] = 0.5;
    p.setData(key, 0.5);
  }

  unsubStateChange?.();
  unsubStateEnd?.();
  unsubListener?.();

  unsubStateChange = p.on('stateChange', e => {
    currentState.value = e.to;
    isInTransition.value = p.isInTransition;
  });
  unsubStateEnd = p.on('stateTransitionEnd', () => {
    isInTransition.value = false;
  });
  unsubListener = p.controller.addListener(() => {
    isInTransition.value = p.isInTransition;
  });
}

onMounted(async () => {
  if (props.example.kind === 'upload') return;          // wait for a file
  if (props.example.source == null) return;
  await buildPlayer(props.example.source);
});

// Once the user picks a file, the drop zone is replaced with the canvas — wait
// for the next tick so the `<canvas>` exists before we hand it to the player.
watch(userSource, async (src) => {
  if (src == null) return;
  await nextTick();
  try {
    await buildPlayer(src);
    loadError.value = null;
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
    userSource.value = null;
    loadedName.value = null;
  }
});

async function onFilePicked(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  await acceptFile(file);
  // Reset so picking the same file again still fires `change`.
  input.value = '';
}

async function onDrop(e: DragEvent): Promise<void> {
  dropHover.value = false;
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  await acceptFile(file);
}

async function acceptFile(file: File): Promise<void> {
  loadError.value = null;
  try {
    const buf = await file.arrayBuffer();
    // Re-allocate so the resulting Uint8Array's backing buffer is a plain
    // ArrayBuffer (the loader signature requires Uint8Array<ArrayBuffer> —
    // ArrayBuffer transferred from a File can be SharedArrayBuffer-flavoured
    // on some browsers).
    const bytes = new Uint8Array(new Uint8Array(buf));
    loadedName.value = file.name;
    userSource.value = bytes;
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : 'Failed to read file';
  }
}

function clearLoadedFile(): void {
  player.value?.dispose();
  player.value = null;
  userSource.value = null;
  loadedName.value = null;
  loadError.value = null;
  dataKeys.value = [];
  states.value = [];
}

onBeforeUnmount(() => {
  unmounted = true;
  unsubStateChange?.();
  unsubStateEnd?.();
  unsubListener?.();
  player.value?.dispose();
});

function onMode(): void {
  if (player.value) player.value.mode = mode.value;
}

function onSpeed(): void {
  if (player.value) player.value.speed = speed.value;
}

function onBoxFit(): void {
  if (player.value) player.value.boxFit = boxFit.value;
}

function onData(key: string, e: Event): void {
  const v = parseFloat((e.target as HTMLInputElement).value);
  dataValues[key] = v;
  player.value?.setData(key, v);
}
</script>
