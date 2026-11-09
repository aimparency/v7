<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useProjectLoadStore } from '../stores/project-load'
import { getRuntimeConfig } from '../utils/runtime-config'

const projectLoad = useProjectLoadStore()
const hosted = getRuntimeConfig().hosted

// Nothing behind the screen reacts to keys. Stopped, not prevented, so Enter
// still presses a focused button.
const takeKeydown = (event: KeyboardEvent) => {
  if (!projectLoad.isActive) return
  event.stopImmediatePropagation()
  if (event.key === 'Escape') projectLoad.cancel()
}
onMounted(() => window.addEventListener('keydown', takeKeydown, { capture: true }))
onUnmounted(() => window.removeEventListener('keydown', takeKeydown, { capture: true }))
</script>

<template>
  <div v-if="projectLoad.isActive" id="project-load-screen" role="status" aria-live="polite">
    <template v-if="projectLoad.status === 'loading'">
      <h1>Opening {{ projectLoad.targetName }}</h1>
      <div class="step">
        <span>{{ projectLoad.detailLabel || projectLoad.stepLabel }}</span>
        <span v-if="projectLoad.detail">{{ projectLoad.detail.done }} / {{ projectLoad.detail.total }}</span>
      </div>
      <div class="bar detail">
        <div
          v-if="projectLoad.detailFraction !== null"
          class="fill"
          :style="{ transform: `scaleX(${projectLoad.detailFraction})` }"
        ></div>
        <div v-else class="fill alive"></div>
      </div>
      <div class="step">
        <span>{{ projectLoad.stepLabel }}</span>
        <span>{{ Math.round(projectLoad.overallFraction * 100) }}%</span>
      </div>
      <div class="bar overall">
        <div class="fill" :style="{ transform: `scaleX(${projectLoad.overallFraction})` }"></div>
      </div>
      <button v-if="!hosted" @click="projectLoad.cancel()">Cancel</button>
    </template>

    <template v-else>
      <h1>Could not open {{ projectLoad.targetName }}</h1>
      <p class="error">{{ projectLoad.error }}</p>
      <div class="actions">
        <button @click="projectLoad.retry()">Retry</button>
        <button v-if="!hosted" @click="projectLoad.cancel()">Back to projects</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
#project-load-screen {
  position: fixed;
  inset: 0;
  z-index: 9000; /* over everything but the toasts */
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.5rem;
  padding: 0 max(1.5rem, calc(50vw - 16rem));
  background: #000;

  & h1 {
    font-size: var(--font-size-title);
    margin-bottom: 1rem;
    overflow-wrap: anywhere;
  }

  & .step {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    font-size: var(--font-size-small);
  }

  & .bar {
    height: 0.4rem;
    overflow: hidden;
    margin-bottom: 0.75rem;
    background: var(--toolbar-group-bg);
  }

  /* Transforms only: the compositor keeps these moving while a mount blocks the page. */
  & .fill {
    height: 100%;
    background: var(--accent);
    transform-origin: left;
    transition: transform 0.2s linear;

    &.alive {
      width: 30%;
      animation: project-load-alive 1s ease-in-out infinite alternate;
    }
  }

  & button {
    align-self: flex-end;
  }

  & .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  & .error {
    font-size: var(--font-size-small);
    color: var(--status-failed);
    margin-bottom: 1rem;
    overflow-wrap: anywhere;
  }
}

@keyframes project-load-alive {
  from { transform: translateX(0); }
  to { transform: translateX(233%); }
}
</style>
