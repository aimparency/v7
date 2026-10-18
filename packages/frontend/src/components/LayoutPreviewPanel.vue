<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import type { LayoutSettings } from 'shared'
import { DEFAULT_LAYOUT_SETTINGS, sameLayoutSettings, type LayoutChange } from '../utils/autolayout'
import SidePanel from './SidePanel.vue'

// Live autolayout: the graph already shows the first `count` changes (most
// relevant first) and the placed unconnected ideas, and re-solves whenever the
// settings change. Nothing is saved until Apply. Positions only: no connection
// changes, so no idea file changes.
const props = defineProps<{ changes: LayoutChange[]; placed: number; saved: Required<LayoutSettings>; solving: boolean }>()
const count = defineModel<number>('count', { required: true })
const positionsOnly = defineModel<boolean>('positionsOnly', { required: true })
const settings = defineModel<Required<LayoutSettings>>('settings', { required: true })
const emit = defineEmits<{ apply: []; cancel: []; resetPositions: [] }>()

// Ranges found with the layout lab (scripts/layout-lab). A logarithmic
// range from 0 is off at the left end, then logarithmic from a hundredth of
// its maximum.
interface Slider { key: keyof LayoutSettings; label: string; hint: string; min: number; max: number; scale: 'linear' | 'log' }
const GROUPS: { name: string; sliders: Slider[] }[] = [
  { name: 'Connections', sliders: [
    { key: 'spacing', label: 'Spacing', hint: 'The length connections are pulled toward, in radius sums (strength: Pull to spacing)', min: 3, max: 5, scale: 'linear' },
    { key: 'length', label: 'Pull to spacing', hint: 'Pull connections toward the spacing length, longer ones in and shorter ones out; important connections more so', min: 0.3, max: 10, scale: 'log' },
    { key: 'importance', label: 'Importance', hint: 'How much a connection\'s value decides its pull and angle: 0 all equal, 1 in proportion to its flow (weak connections then fly far out)', min: 0, max: 1, scale: 'linear' },
    { key: 'memory', label: 'Keep as is', hint: 'Keep stored connection offsets; higher means fewer, smaller changes', min: 0.3, max: 10, scale: 'log' }
  ] },
  { name: 'Angles', sliders: [
    { key: 'spread', label: 'Even spread', hint: 'Turn the connections around an idea apart when they share too narrow an angle', min: 0.1, max: 5, scale: 'log' },
    { key: 'outward', label: 'Outward', hint: 'Keep children out of the half circle behind their parent', min: 0.15, max: 15, scale: 'log' }
  ] },
  { name: 'Space', sliders: [
    { key: 'space', label: 'Minimum space', hint: 'Radius sums every idea keeps from every other, connected or not; connected ideas at most the spacing', min: 3, max: 8, scale: 'linear' },
    { key: 'separation', label: 'Space push', hint: 'How hard ideas inside the minimum space push apart', min: 0.5, max: 50, scale: 'log' },
    { key: 'spaceCurve', label: 'Space curve', hint: '0: the same push throughout the space; 1: growing with 1 / the gap between their edges, endless when touching; 2: with its square', min: 0, max: 2, scale: 'linear' }
  ] },
  { name: 'Similarity', sliders: [
    { key: 'semantic', label: 'Toward similar', hint: 'Pull every idea, connected or not, toward its 12 most similar ideas; higher tangles the network', min: 0, max: 1, scale: 'log' }
  ] }
]
const OFF_RANGE = 100 // a logarithmic range from 0: its logarithmic part spans max / 100 to max
const logMin = ({ min, max }: Slider) => min > 0 ? min : max / OFF_RANGE
const toSlider = (slider: Slider) => {
  const value = settings.value[slider.key]
  if (slider.scale === 'linear') return value
  if (value <= 0) return 0
  return Math.min(1, Math.max(0, Math.log(value / logMin(slider)) / Math.log(slider.max / logMin(slider))))
}
const setSetting = (slider: Slider, position: number) => {
  const value = slider.scale === 'linear' ? position
    : slider.min === 0 && position === 0 ? 0
    : logMin(slider) * (slider.max / logMin(slider)) ** position
  settings.value = { ...settings.value, [slider.key]: Number(value.toPrecision(2)) }
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
  <SidePanel>
    <div id="layout-preview">
      <h3>Layout <span v-if="solving" class="hint">solving…</span></h3>
      <div class="settings">
        <button
          class="btn-secondary reset-positions"
          title="Start again from the stored layout, with these settings"
          @click="emit('resetPositions')"
        >Reset positions</button>
        <fieldset v-for="group in GROUPS" :key="group.name">
          <legend>{{ group.name }}</legend>
          <label v-for="slider in group.sliders" :key="slider.key" :title="slider.hint">
            <span class="name">
              <span>{{ slider.label }}</span>
              <span class="value">{{ settings[slider.key] }}</span>
            </span>
            <input
              type="range"
              :name="slider.key"
              :min="slider.scale === 'linear' ? slider.min : 0"
              :max="slider.scale === 'linear' ? slider.max : 1"
              :step="slider.scale === 'linear' ? (slider.max - slider.min) / 100 : 0.01"
              :value="toSlider(slider)"
              @input="setSetting(slider, Number(($event.target as HTMLInputElement).value))"
            />
          </label>
        </fieldset>
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
  </SidePanel>
</template>

<style scoped>
#layout-preview {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
  overflow-y: auto;
  padding: 1rem 1rem 1rem 0.25rem;
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

    & .reset-positions {
      align-self: flex-end;
    }

    & fieldset {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
      gap: 0.3rem 0.75rem;
      margin: 0;
      padding: 0.3rem 0.5rem 0.5rem;
      border: 1px solid #333;
      border-radius: 4px;
    }

    & legend {
      padding: 0 0.3rem;
      opacity: 0.6;
    }

    & input {
      width: 100%;
      margin: 0;
    }
  }

  & .settings label, & .fader {
    display: flex;
    flex-direction: column;

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
