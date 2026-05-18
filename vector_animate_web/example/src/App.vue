<template>
  <div class="app">
    <aside class="sidebar">
      <h1>vector_animate_web</h1>
      <p class="subtitle">Runtime examples</p>
      <nav>
        <button
          v-for="ex in examples"
          :key="ex.id"
          :class="{ active: ex.id === current.id }"
          @click="current = ex"
        >
          {{ ex.name }}
        </button>
      </nav>
    </aside>
    <main class="main">
      <AnimationDemo :example="current" :key="current.id" />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import AnimationDemo from './AnimationDemo.vue';
import { examples } from './examples';

const current = ref(examples[0]!);
</script>
