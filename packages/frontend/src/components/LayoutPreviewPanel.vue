<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import type { LayoutSettings } from 'shared'
import { DEFAULT_LAYOUT_SETTINGS, sameLayoutSettings, type LayoutChange } from '../utils/autolayout'

// Live autolayout: the graph already shows the first `count` changes (most
// relevant first) and the placed unconnected ideas, and re-solves whenever the
// settings change. Nothing is saved until Apply. Positions only: no connection
// changes, so no idea file changes.
const props = defineProps<{ changes: LayoutChange[]; placed: number; saved: LayoutSettings; solving: boolean }>()
const count = defineModel<number>('count', { required: true })
const positionsOnly = defineModel<boolean>('positionsOnly', { required: true })
const settings = defineModel<LayoutSettings>('settings', { required: true })
const emit = defineEmits<{ apply: []; cancel: []; resetPositions: [] }>()

type Weight = Exclude<keyof LayoutSettings, 'spacing'>
// Each weight slides logarithmically from a tenth to ten times its default.
const WEIGHTS: { key: Weight; label: string; hint: string }[] = [
  { key: 'memory', label: 'Keep as is', hint: 'Keep stored connection offsets; higher means fewer, smaller changes' },
  { key: 'length', label: 'Pull to spacing', hint: 'Pull connections toward the spacing length, longer ones in and shorter ones out; strong connections more so' },
  { key: 'spread', label: 'Even spread', hint: 'Turn the connections around an idea apart when they share too narrow an angle' },
  { key: 'outward', label: 'Outward', hint: 'Keep children out of the half circle behind their parent' },
  { key: 'semantic', label: 'Similar together', hint: 'Pull semantically similar ideas of the big network together; weak, strong pulls tangle its connections' },
  { key: 'isolatedSemantic', label: 'Unconnected toward similar', hint: 'Pull unconnected ideas and small networks toward their most similar ideas; small networks get a mix of both' }
]
const RANGE = 100 // max / min
const toSlider = (key: Weight) => Math.log(settings.value[key] * 10 / DEFAULT_LAYOUT_SETTINGS[key]) / Math.log(RANGE)
const setWeight = (key: Weight, slider: number) => {
  const value = DEFAULT_LAYOUT_SETTINGS[key] / 10 * RANGE ** slider
  settings.value = { ...settings.value, [key]: Number(value.toPrecision(2)) }
}

const noChanges = computed(() => props.changes.length === 0)
const shown = computed(() => positionsOnly.value || noChanges.value ? 0 : count.value)
const files = computed(() => new Set(props.changes.slice(0, shown.value).map(change => change.parentId)).size)
const unsaved = computed(() => !sameLayoutSettings(settings.value, props.saved))
const isDefault = computed(() => sameLayoutSettings(settings.value, DEFAULT_LAYOUT_SETTINGS))

const onKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  emit('cancel')
}
onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <div id="layout-preview">
    <h3>Layout <span v-if="solving" class="hint">solving…</span></h3>
    <div class="settings">
      <label title="The length connections are pulled toward, in radius sums (strength: Pull to spacing); 3 is the minimum distance between any two ideas">
        <span class="name">Spacing <span class="value">{{ settings.spacing.toFixed(1) }}</span></span>
        <input
          type="range" min="3" max="5" step="0.1"
          :value="settings.spacing"
          @input="settings = { ...settings, spacing: Number(($event.target as HTMLInputElement).value) }"
        />
      </label>
      <label v-for="weight in WEIGHTS" :key="weight.key" :title="weight.hint">
        <span class="name">
          <span>
            {{ weight.label }}
            <button
              v-if="weight.key === 'memory'"
              class="btn-secondary"
              title="Start again from the stored layout, with these settings"
              @click.prevent="emit('resetPositions')"
            >Reset positions</button>
          </span>
          <span class="value">{{ settings[weight.key] }}</span>
        </span>
        <input
          type="range" min="0" max="1" step="0.01"
          :value="toSlider(weight.key)"
          @input="setWeight(weight.key, Number(($event.target as HTMLInputElement).value))"
        />
      </label>
    </div>
    <div v-if="unsaved || !isDefault" class="row">
      <span v-if="unsaved" class="hint">Differs from the saved settings; Apply saves them to meta.json.</span>
      <button v-if="unsaved" class="btn-secondary" @click="settings = { ...saved }">Reset</button>
      <button v-if="!isDefault" class="btn-secondary" @click="settings = { ...DEFAULT_LAYOUT_SETTINGS }">Defaults</button>
    </div>

    <label class="fader" :class="{ disabled: positionsOnly || noChanges }">
      <span>Connections changed: {{ shown }} of {{ changes.length }} ({{ files }} idea files)</span>
      <input v-model.number="count" type="range" min="0" :max="changes.length" step="1" :disabled="positionsOnly || noChanges" />
    </label>
    <span>Unconnected ideas placed: {{ placed }} (positions in this browser)</span>
    <label class="option">
      <input
        type="checkbox"
        :checked="positionsOnly || noChanges"
        :disabled="noChanges"
        @change="positionsOnly = ($event.target as HTMLInputElement).checked"
      />
      <span>Only update absolute positions (local, no file changes)</span>
    </label>
    <div class="row">
      <button class="btn-secondary" @click="emit('cancel')">Cancel</button>
      <button class="btn-primary" @click="emit('apply')">Apply</button>
    </div>
  </div>
</template>

<style scoped>
#layout-preview {
  position: absolute;
  right: 20px;
  top: 20px;
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: min(22rem, calc(100% - 40px));
  max-height: calc(100% - 40px);
  overflow-y: auto;
  padding: 1rem;
  background: #1e1e1e;
  border: 1px solid #333;
  border-radius: 8px;
  font-size: var(--font-size-small);

  & h3 {
    margin: 0;
  }

  & .hint {
    opacity: 0.6;
  }

  & .settings {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  & .settings label, & .fader {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;

    & .name {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    & .value {
      font-variant-numeric: tabular-nums;
      opacity: 0.6;
    }

    &.disabled {
      opacity: 0.5;
    }
  }

  & .option {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  & .row {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 0.5rem;

    & .hint {
      flex: 1;
    }
  }
}
</style>
