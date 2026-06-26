<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';

type AgentType = 'claude' | 'gemini' | 'codex' | 'agy' | 'grok';

defineProps<{ modelValue: AgentType }>();
const emit = defineEmits<{ 'update:modelValue': [AgentType] }>();

const options: AgentType[] = ['claude', 'gemini', 'codex', 'agy', 'grok'];
const open = ref(false);
const root = ref<HTMLElement | null>(null);

function choose(opt: AgentType) {
  emit('update:modelValue', opt);
  open.value = false;
}

function onDocClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}

onMounted(() => document.addEventListener('click', onDocClick));
onUnmounted(() => document.removeEventListener('click', onDocClick));
</script>

<template>
  <div ref="root" class="agent-select">
    <button type="button" class="trigger" @click.stop="open = !open">
      <span class="agent-badge" :class="modelValue">{{ modelValue }}</span>
      <span class="caret">▾</span>
    </button>
    <div v-if="open" class="menu">
      <div
        v-for="opt in options"
        :key="opt"
        class="option"
        :class="{ active: opt === modelValue }"
        @click="choose(opt)"
      >
        <span class="agent-badge" :class="opt">{{ opt }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.agent-select {
  position: relative;

  .trigger {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px;
    background: #222;
    border: 1px solid #444;
    border-radius: 4px;
    color: white;
    font-size: 14px;
    cursor: pointer;
  }

  .caret { color: #888; font-size: 10px; }

  .menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 10;
    min-width: 100%;
    padding: 4px;
    background: #1a1a1a;
    border: 1px solid #444;
    border-radius: 4px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);

    .option {
      padding: 6px;
      border-radius: 3px;
      cursor: pointer;

      &:hover { background: #2a2a2a; }
      &.active { background: #333; }
    }
  }
}
</style>
