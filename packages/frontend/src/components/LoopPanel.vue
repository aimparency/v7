<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { trpc } from '../trpc'
import { useProjectStore } from '../stores/project-store'
import { useDataStore } from '../stores/data'
import { useUIModalStore } from '../stores/ui/modal-store'
import type { AimSearchPickPayload } from '../stores/ui/aim-search-types'
import type { PhaseSearchSelection } from '../stores/ui/phase-search-types'

type LoopProvider = 'nvidia' | 'openrouter' | 'openai-compatible'
type LoopStopPolicy = 'target_halted' | 'phase_done' | 'never' | 'asap'
type LoopDefinition = {
  id: string
  name: string
  systemPrompt: string
  provider: LoopProvider
  model: string
  baseUrl: string
  intervalSeconds: number
  associationChance: number
  createdAt: number
  updatedAt: number
}
type LoopMessage = {
  id: string
  role: string
  kind: 'event' | 'text' | 'status' | 'error' | 'human_action_required'
  content: string
  timestamp: number
  requestId?: string
  replyToRequestId?: string
}
type LoopInstance = {
  id: string
  loopId: string
  name: string
  status: 'idle' | 'running' | 'waiting_for_human' | 'stopped' | 'done' | 'error'
  targetPhaseId: string | null
  targetAimId: string | null
  stopPolicy: LoopStopPolicy
  currentActivity: string | null
  createdAt: number
  updatedAt: number
  messages: LoopMessage[]
}

const projectStore = useProjectStore()
const dataStore = useDataStore()
const modalStore = useUIModalStore()

const loading = ref(false)
const saving = ref(false)
const message = ref('')
const loops = ref<LoopDefinition[]>([])
const instances = ref<LoopInstance[]>([])
const selectedLoopId = ref<string | null>(null)
const selectedInstanceId = ref<string | null>(null)
const loopNameDraft = ref('')
const systemPromptDraft = ref('')
const configDirty = ref(false)
const provider = ref<LoopProvider>('nvidia')
const model = ref('z-ai/glm-5.2')
const baseUrl = ref('https://integrate.api.nvidia.com/v1')
const intervalSeconds = ref(60)
const associationChancePercent = ref(10)
const nvidiaApiKey = ref('')
const openrouterApiKey = ref('')
const loopApiKey = ref('')
const humanMessage = ref('')
const instanceNameDraft = ref('')
const instanceNameDirty = ref(false)
const stopPolicyDraft = ref<LoopStopPolicy>('target_halted')
const phaseLabels = ref<Record<string, string>>({})
const aimLabels = ref<Record<string, string>>({})
const loopLogRef = ref<HTMLDivElement>()
const focusedLogIndex = ref(-1)
const expandedLogIds = ref<Set<string>>(new Set())
const secretsPresent = ref({
  NVIDIA_API_KEY: false,
  OPENROUTER_API_KEY: false,
  LOOP_API_KEY: false
})
let pollTimer: number | undefined

const selectedLoop = computed(() => loops.value.find((loop) => loop.id === selectedLoopId.value) ?? null)
const selectedInstance = computed(() => instances.value.find((instance) => instance.id === selectedInstanceId.value) ?? null)
const loopInstances = computed(() => instances.value.filter((instance) => instance.loopId === selectedLoopId.value))
const showingConfig = computed(() => Boolean(selectedLoop.value) && selectedInstanceId.value === null)
const hasWaitingInstances = computed(() => instances.value.some((instance) => instance.status === 'waiting_for_human'))
const selectedHumanRequest = computed(() => [...(selectedInstance.value?.messages ?? [])].reverse().find((message) => message.kind === 'human_action_required'))
const selectedMessages = computed(() => selectedInstance.value?.messages ?? [])
const selectedTargetPhaseLabel = computed(() => {
  const id = selectedInstance.value?.targetPhaseId
  if (!id) return 'No phase'
  return dataStore.phases[id]?.name ?? phaseLabels.value[id] ?? 'Loading phase...'
})
const selectedTargetAimLabel = computed(() => {
  const id = selectedInstance.value?.targetAimId
  if (!id) return 'No aim'
  return dataStore.aims[id]?.text ?? aimLabels.value[id] ?? 'Loading aim...'
})
const stopPolicyOptions = computed<Array<{ value: LoopStopPolicy; label: string }>>(() => [
  ...(selectedInstance.value?.targetAimId ? [{ value: 'target_halted' as const, label: 'aim halted' }] : []),
  ...(selectedInstance.value?.targetPhaseId ? [{ value: 'phase_done' as const, label: 'phase done' }] : []),
  { value: 'never', label: 'never' },
  { value: 'asap', label: 'asap' }
])
const coerceStopPolicy = (policy: LoopStopPolicy | undefined) =>
  stopPolicyOptions.value.some((option) => option.value === policy) ? policy! : 'never'
const requiredSecretLabel = computed(() => {
  if (provider.value === 'nvidia') return 'NVIDIA_API_KEY'
  if (provider.value === 'openrouter') return 'OPENROUTER_API_KEY'
  return 'LOOP_API_KEY'
})

const resolveTargetLabels = async () => {
  if (!projectStore.projectPath) return
  const phaseIds = [...new Set(instances.value.map((instance) => instance.targetPhaseId).filter((id): id is string => Boolean(id)))]
  const aimIds = [...new Set(instances.value.map((instance) => instance.targetAimId).filter((id): id is string => Boolean(id)))]
  await Promise.all([
    ...phaseIds
      .filter((id) => !dataStore.phases[id] && !phaseLabels.value[id])
      .map(async (id) => {
        try {
          const phase = await trpc.phase.get.query({ projectPath: projectStore.projectPath, phaseId: id })
          phaseLabels.value = { ...phaseLabels.value, [id]: phase.name }
        } catch {}
      }),
    ...aimIds
      .filter((id) => !dataStore.aims[id] && !aimLabels.value[id])
      .map(async (id) => {
        try {
          const aim = await trpc.aim.get.query({ projectPath: projectStore.projectPath, aimId: id })
          aimLabels.value = { ...aimLabels.value, [id]: aim.text }
        } catch {}
      })
  ])
}

const hydrate = async () => {
  if (!projectStore.projectPath) return
  const previousLoopId = selectedLoopId.value
  loading.value = true
  try {
    const [runtime, config] = await Promise.all([
      trpc.project.getLoopRuntimeState.query({ projectPath: projectStore.projectPath }),
      trpc.project.getLoopRuntimeConfig.query({ projectPath: projectStore.projectPath })
    ])
    loops.value = runtime.loops
    instances.value = runtime.instances
    void resolveTargetLabels()
    projectStore.loopHasHumanRequests = instances.value.some((instance) => instance.status === 'waiting_for_human')
    selectedLoopId.value = selectedLoopId.value && loops.value.some((loop) => loop.id === selectedLoopId.value)
      ? selectedLoopId.value
      : runtime.selectedLoopId ?? loops.value[0]?.id ?? null
    if (selectedInstanceId.value && !instances.value.some((instance) => instance.id === selectedInstanceId.value)) {
      selectedInstanceId.value = null
    }
    if (!instanceNameDirty.value) {
      instanceNameDraft.value = selectedInstance.value?.name ?? ''
    }
    stopPolicyDraft.value = coerceStopPolicy(selectedInstance.value?.stopPolicy)
    if (selectedLoopId.value !== previousLoopId || !configDirty.value) {
      loopNameDraft.value = selectedLoop.value?.name ?? ''
      systemPromptDraft.value = selectedLoop.value?.systemPrompt ?? ''
      provider.value = selectedLoop.value?.provider ?? 'nvidia'
      model.value = selectedLoop.value?.model ?? 'z-ai/glm-5.2'
      baseUrl.value = selectedLoop.value?.baseUrl ?? 'https://integrate.api.nvidia.com/v1'
      intervalSeconds.value = selectedLoop.value?.intervalSeconds ?? 60
      associationChancePercent.value = Math.round((selectedLoop.value?.associationChance ?? 0.1) * 100)
      configDirty.value = false
    }
    secretsPresent.value = config.secretsPresent
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error)
  } finally {
    loading.value = false
  }
}

const saveConfig = async () => {
  if (!projectStore.projectPath || !selectedLoop.value) return
  saving.value = true
  message.value = ''
  try {
    await trpc.project.updateLoop.mutate({
        projectPath: projectStore.projectPath,
        loopId: selectedLoop.value.id,
        name: loopNameDraft.value,
        systemPrompt: systemPromptDraft.value,
        provider: provider.value,
        model: model.value,
        baseUrl: baseUrl.value,
        intervalSeconds: intervalSeconds.value,
        associationChance: Math.max(0, Math.min(associationChancePercent.value / 100, 1))
      })
    const secrets: Record<string, string> = {}
    if (nvidiaApiKey.value) secrets.NVIDIA_API_KEY = nvidiaApiKey.value
    if (openrouterApiKey.value) secrets.OPENROUTER_API_KEY = openrouterApiKey.value
    if (loopApiKey.value) secrets.LOOP_API_KEY = loopApiKey.value
    if (Object.keys(secrets).length > 0) {
      secretsPresent.value = await trpc.project.updateLoopSecrets.mutate({ projectPath: projectStore.projectPath, secrets })
      nvidiaApiKey.value = ''
      openrouterApiKey.value = ''
      loopApiKey.value = ''
    }
    message.value = 'Saved'
    configDirty.value = false
    await hydrate()
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error)
  } finally {
    saving.value = false
  }
}

const createLoop = async () => {
  if (!projectStore.projectPath) return
  const runtime = await trpc.project.createLoop.mutate({ projectPath: projectStore.projectPath })
  loops.value = runtime.loops
  instances.value = runtime.instances
  selectedLoopId.value = runtime.selectedLoopId
  selectedInstanceId.value = null
  loopNameDraft.value = loops.value.find((loop) => loop.id === selectedLoopId.value)?.name ?? ''
  systemPromptDraft.value = loops.value.find((loop) => loop.id === selectedLoopId.value)?.systemPrompt ?? ''
  configDirty.value = false
}

const duplicateLoop = async () => {
  if (!projectStore.projectPath || !selectedLoop.value) return
  const runtime = await trpc.project.duplicateLoop.mutate({ projectPath: projectStore.projectPath, loopId: selectedLoop.value.id })
  loops.value = runtime.loops
  instances.value = runtime.instances
  selectedLoopId.value = runtime.selectedLoopId
  selectedInstanceId.value = null
  const duplicated = loops.value.find((loop) => loop.id === selectedLoopId.value)
  loopNameDraft.value = duplicated?.name ?? ''
  systemPromptDraft.value = duplicated?.systemPrompt ?? ''
  provider.value = duplicated?.provider ?? 'nvidia'
  model.value = duplicated?.model ?? 'z-ai/glm-5.2'
  baseUrl.value = duplicated?.baseUrl ?? 'https://integrate.api.nvidia.com/v1'
  intervalSeconds.value = duplicated?.intervalSeconds ?? 60
  associationChancePercent.value = Math.round((duplicated?.associationChance ?? 0.1) * 100)
  configDirty.value = false
}

const deleteLoop = async () => {
  if (!projectStore.projectPath || !selectedLoop.value) return
  if (!confirm(`Delete loop "${selectedLoop.value.name}" and all its instances?`)) return
  const runtime = await trpc.project.deleteLoop.mutate({ projectPath: projectStore.projectPath, loopId: selectedLoop.value.id })
  loops.value = runtime.loops
  instances.value = runtime.instances
  selectedLoopId.value = runtime.selectedLoopId
  selectedInstanceId.value = null
  loopNameDraft.value = loops.value.find((loop) => loop.id === selectedLoopId.value)?.name ?? ''
  systemPromptDraft.value = loops.value.find((loop) => loop.id === selectedLoopId.value)?.systemPrompt ?? ''
  configDirty.value = false
}

const createInstance = async () => {
  if (!projectStore.projectPath || !selectedLoopId.value) return
  const runtime = await trpc.project.createLoopInstance.mutate({ projectPath: projectStore.projectPath, loopId: selectedLoopId.value })
  loops.value = runtime.loops
  instances.value = runtime.instances
  selectedInstanceId.value = runtime.selectedInstanceId ?? null
}

const deleteInstance = async () => {
  if (!projectStore.projectPath || !selectedInstance.value) return
  if (!confirm(`Close instance "${selectedInstance.value.name}"?`)) return
  const runtime = await trpc.project.deleteLoopInstance.mutate({ projectPath: projectStore.projectPath, instanceId: selectedInstance.value.id })
  loops.value = runtime.loops
  instances.value = runtime.instances
  selectedInstanceId.value = null
}

const updateSelectedInstance = async (patch: Partial<Pick<LoopInstance, 'name' | 'targetPhaseId' | 'targetAimId' | 'stopPolicy'>>) => {
  if (!projectStore.projectPath || !selectedInstance.value) return
  const runtime = await trpc.project.updateLoopInstance.mutate({
    projectPath: projectStore.projectPath,
    instanceId: selectedInstance.value.id,
    ...patch
  })
  loops.value = runtime.loops
  instances.value = runtime.instances
  void resolveTargetLabels()
}

const updateStopPolicy = async () => {
  await updateSelectedInstance({ stopPolicy: stopPolicyDraft.value })
}

const retargetSelectedInstance = async (patch: Partial<Pick<LoopInstance, 'targetPhaseId' | 'targetAimId'>>) => {
  const nextStopPolicy = (
    (patch.targetAimId === null && stopPolicyDraft.value === 'target_halted') ||
    (patch.targetPhaseId === null && stopPolicyDraft.value === 'phase_done')
  ) ? 'never' : stopPolicyDraft.value
  await updateSelectedInstance({ ...patch, stopPolicy: nextStopPolicy })
  stopPolicyDraft.value = nextStopPolicy
}

const saveInstanceName = async () => {
  if (!instanceNameDirty.value || !instanceNameDraft.value.trim()) return
  await updateSelectedInstance({ name: instanceNameDraft.value.trim() })
  instanceNameDirty.value = false
}

const openPhaseTargetSearch = () => {
  modalStore.openPhaseSearchPrompt(async (payload: PhaseSearchSelection) => {
    if (payload.type === 'option' && payload.data.id === 'none') {
      await retargetSelectedInstance({ targetPhaseId: null, targetAimId: null })
      modalStore.closePhaseSearchPrompt()
      return
    }
    if (payload.type !== 'phase') return
    phaseLabels.value = { ...phaseLabels.value, [payload.data.id]: payload.data.name }
    await retargetSelectedInstance({ targetPhaseId: payload.data.id })
    modalStore.closePhaseSearchPrompt()
  }, {
    title: 'Select Loop Phase',
    placeholder: 'Search target phase...',
    additionalOptions: [{
      id: 'none',
      label: 'No phase',
      description: 'Let the loop choose from the active phase dynamically.',
      showWhenQueryEmptyOnly: true
    }]
  })
}

const openAimTargetSearch = () => {
  modalStore.openAimSearch('pick', async (payload: AimSearchPickPayload) => {
    if (payload.type === 'option' && payload.data.id === 'none') {
      await retargetSelectedInstance({ targetAimId: null })
      modalStore.closeAimSearch()
      return
    }
    if (payload.type !== 'aim') return
    aimLabels.value = { ...aimLabels.value, [payload.data.id]: payload.data.text }
    const targetPhaseId = selectedInstance.value?.targetPhaseId ?? payload.data.committedIn?.[0] ?? null
    await retargetSelectedInstance({
      targetPhaseId,
      targetAimId: payload.data.id
    })
    modalStore.closeAimSearch()
  }, undefined, {
    title: 'Select Loop Aim',
    placeholder: 'Search target aim...',
    showFilters: true,
    additionalOptions: [{
      id: 'none',
      label: 'No aim',
      description: 'Let the loop choose the highest-priority open aim dynamically.',
      showWhenQueryEmptyOnly: true
    }]
  })
}

const startInstance = async () => {
  if (!projectStore.projectPath || !selectedInstance.value) return
  await trpc.project.startLoopInstance.mutate({ projectPath: projectStore.projectPath, instanceId: selectedInstance.value.id })
  await hydrate()
}

const stopInstance = async () => {
  if (!projectStore.projectPath || !selectedInstance.value) return
  await trpc.project.stopLoopInstance.mutate({ projectPath: projectStore.projectPath, instanceId: selectedInstance.value.id })
  await hydrate()
}

const restartInstance = async () => {
  if (!projectStore.projectPath || !selectedInstance.value) return
  if (!confirm(`Restart instance "${selectedInstance.value.name}" and erase its log?`)) return
  const runtime = await trpc.project.restartLoopInstance.mutate({ projectPath: projectStore.projectPath, instanceId: selectedInstance.value.id })
  loops.value = runtime.loops
  instances.value = runtime.instances
  focusedLogIndex.value = -1
  expandedLogIds.value = new Set()
  await scrollLoopLogToBottom()
}

const sendHumanMessage = async () => {
  if (!projectStore.projectPath || !selectedInstance.value || !humanMessage.value.trim()) return
  const text = humanMessage.value.trim()
  humanMessage.value = ''
  const runtime = await trpc.project.sendLoopHumanMessage.mutate({
    projectPath: projectStore.projectPath,
    instanceId: selectedInstance.value.id,
    content: text,
    replyToRequestId: selectedHumanRequest.value?.id
  })
  loops.value = runtime.loops
  instances.value = runtime.instances
}

const scrollLoopLogToBottom = async () => {
  await nextTick()
  const el = loopLogRef.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

const focusLogIndex = async (index: number) => {
  const messages = selectedMessages.value
  if (messages.length === 0) return
  focusedLogIndex.value = Math.max(0, Math.min(index, messages.length - 1))
  await nextTick()
  loopLogRef.value
    ?.querySelectorAll<HTMLElement>('.message-line')
    [focusedLogIndex.value]
    ?.scrollIntoView({ block: 'nearest' })
}

const toggleLogExpansion = (messageId: string, expanded: boolean) => {
  const next = new Set(expandedLogIds.value)
  if (expanded) next.add(messageId)
  else next.delete(messageId)
  expandedLogIds.value = next
}

const handleLogKeydown = (event: KeyboardEvent) => {
  if (!['j', 'k', 'h', 'l', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
  if (selectedMessages.value.length === 0) return
  event.preventDefault()
  event.stopPropagation()
  const current = focusedLogIndex.value >= 0 ? focusedLogIndex.value : selectedMessages.value.length - 1
  if (event.key === 'j' || event.key === 'ArrowDown') {
    void focusLogIndex(current + 1)
    return
  }
  if (event.key === 'k' || event.key === 'ArrowUp') {
    void focusLogIndex(current - 1)
    return
  }
  const message = selectedMessages.value[current]
  if (!message) return
  if (event.key === 'l' || event.key === 'ArrowRight') toggleLogExpansion(message.id, true)
  if (event.key === 'h' || event.key === 'ArrowLeft') toggleLogExpansion(message.id, false)
}

watch(provider, () => {
  if (provider.value === 'nvidia') {
    if (!model.value || model.value.includes('claude')) model.value = 'z-ai/glm-5.2'
    baseUrl.value = 'https://integrate.api.nvidia.com/v1'
  } else if (provider.value === 'openrouter') {
    if (!model.value || model.value === 'z-ai/glm-5.2') model.value = 'anthropic/claude-sonnet-4.6'
    baseUrl.value = 'https://openrouter.ai/api/v1'
  }
})

watch(selectedLoopId, () => {
  loopNameDraft.value = selectedLoop.value?.name ?? ''
  systemPromptDraft.value = selectedLoop.value?.systemPrompt ?? ''
  provider.value = selectedLoop.value?.provider ?? 'nvidia'
  model.value = selectedLoop.value?.model ?? 'z-ai/glm-5.2'
  baseUrl.value = selectedLoop.value?.baseUrl ?? 'https://integrate.api.nvidia.com/v1'
  intervalSeconds.value = selectedLoop.value?.intervalSeconds ?? 60
  associationChancePercent.value = Math.round((selectedLoop.value?.associationChance ?? 0.1) * 100)
  configDirty.value = false
})

watch(selectedInstanceId, () => {
  instanceNameDraft.value = selectedInstance.value?.name ?? ''
  stopPolicyDraft.value = coerceStopPolicy(selectedInstance.value?.stopPolicy)
  instanceNameDirty.value = false
  void scrollLoopLogToBottom()
})

watch(
  () => selectedInstance.value?.messages.map((msg) => msg.id).join('|') ?? '',
  (next, previous) => {
    const wasAtBottom = focusedLogIndex.value === -1 || focusedLogIndex.value >= selectedMessages.value.length - 2
    void scrollLoopLogToBottom()
    if (wasAtBottom) focusedLogIndex.value = selectedMessages.value.length - 1
  }
)

onMounted(() => {
  void hydrate()
  pollTimer = window.setInterval(() => {
    if (projectStore.showLoop) void hydrate()
  }, 1500)
})

onUnmounted(() => {
  if (pollTimer) window.clearInterval(pollTimer)
})
</script>

<template>
  <div class="loop-panel">
    <aside class="column loop-column">
      <button
        v-for="loop in loops"
        :key="loop.id"
        class="nav-item"
        :class="{ active: loop.id === selectedLoopId }"
        @click="selectedLoopId = loop.id; selectedInstanceId = null"
      >
        <span>{{ loop.name }}</span>
        <span v-if="instances.some((instance) => instance.loopId === loop.id && instance.status === 'waiting_for_human')" class="notify-dot"></span>
      </button>
      <button class="add-item" @click="createLoop">+</button>
    </aside>

    <aside class="column instance-column">
      <button
        v-for="instance in loopInstances"
        :key="instance.id"
        class="nav-item instance-item"
        :class="{ active: instance.id === selectedInstanceId }"
        @click="selectedInstanceId = instance.id"
      >
        <span>{{ instance.name }}</span>
        <small>
          <span v-if="instance.status === 'waiting_for_human'" class="notify-dot inline"></span>
          {{ instance.status }}
        </small>
      </button>
      <button class="add-item" :disabled="!selectedLoopId" @click="createInstance">+</button>
    </aside>

    <section class="main">
      <div class="main-header">
        <div class="header-main">
          <template v-if="showingConfig">
            <strong>Loop configuration</strong>
            <button class="action-btn header-btn" @click="duplicateLoop">Duplicate</button>
          </template>
          <template v-else-if="selectedInstance">
            <input
              v-model="instanceNameDraft"
              class="instance-name-input"
              @input="instanceNameDirty = true"
              @blur="saveInstanceName"
              @keydown.enter.prevent="saveInstanceName"
            >
            <button class="target-chip" @click="openPhaseTargetSearch">{{ selectedTargetPhaseLabel }}</button>
            <button class="target-chip aim-chip" @click="openAimTargetSearch">{{ selectedTargetAimLabel }}</button>
            <button class="primary-btn header-btn" :disabled="selectedInstance.status === 'running'" @click="startInstance">Start</button>
            <button class="action-btn header-btn" :disabled="selectedInstance.status !== 'running'" @click="stopInstance">Stop</button>
            <button class="action-btn header-btn" @click="restartInstance">Restart</button>
            <label class="stop-policy">
              <span>when</span>
              <select v-model="stopPolicyDraft" @change="updateStopPolicy">
                <option
                  v-for="option in stopPolicyOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
            </label>
          </template>
          <span v-if="hasWaitingInstances" class="waiting-note">human input requested</span>
          <span v-if="message" class="message">{{ message }}</span>
        </div>
        <button v-if="!showingConfig && selectedInstance" class="danger-btn" @click="deleteInstance">x</button>
      </div>

      <div v-if="showingConfig && selectedLoop" class="config-view">
        <label class="field">
          <span>Loop name</span>
          <input v-model="loopNameDraft" @input="configDirty = true">
        </label>

        <label class="field">
          <span>Conversation prefix / system prompt</span>
          <textarea v-model="systemPromptDraft" rows="8" @input="configDirty = true"></textarea>
        </label>

        <div class="provider-grid">
          <label class="field">
            <span>Provider</span>
            <select v-model="provider" @change="configDirty = true">
              <option value="nvidia">NVIDIA NIM</option>
              <option value="openrouter">OpenRouter</option>
              <option value="openai-compatible">OpenAI-compatible</option>
            </select>
          </label>
          <label class="field">
            <span>Model</span>
            <input v-model="model" spellcheck="false" @input="configDirty = true">
          </label>
          <label class="field wide">
            <span>Base URL</span>
            <input v-model="baseUrl" spellcheck="false" @input="configDirty = true">
          </label>
          <label class="field">
            <span>Loop interval seconds</span>
            <input v-model.number="intervalSeconds" type="number" min="5" max="3600" step="5" @input="configDirty = true">
          </label>
          <label class="field">
            <span>Association chance percent</span>
            <input v-model.number="associationChancePercent" type="number" min="0" max="100" step="1" @input="configDirty = true">
          </label>
        </div>

        <label v-if="provider === 'nvidia'" class="field">
          <span>NVIDIA API key <em v-if="secretsPresent.NVIDIA_API_KEY">saved</em></span>
          <input v-model="nvidiaApiKey" type="password" autocomplete="off" placeholder="Paste to update">
        </label>
        <label v-else-if="provider === 'openrouter'" class="field">
          <span>OpenRouter API key <em v-if="secretsPresent.OPENROUTER_API_KEY">saved</em></span>
          <input v-model="openrouterApiKey" type="password" autocomplete="off" placeholder="Paste to update">
        </label>
        <label v-else class="field">
          <span>Generic API key <em v-if="secretsPresent.LOOP_API_KEY">saved</em></span>
          <input v-model="loopApiKey" type="password" autocomplete="off" placeholder="Paste to update">
        </label>
        <p class="hint">Keys are stored locally in <code>.bowman/secrets.json</code>.</p>

        <div class="config-actions">
          <span :class="['secret-state', { missing: !secretsPresent[requiredSecretLabel] }]">
            {{ secretsPresent[requiredSecretLabel] ? `${requiredSecretLabel} saved` : `${requiredSecretLabel} missing` }}
          </span>
          <button class="danger-btn" @click="deleteLoop">Delete loop</button>
          <button class="primary-btn" :disabled="saving" @click="saveConfig">{{ saving ? 'Saving...' : 'Save' }}</button>
        </div>
      </div>

      <div v-else-if="selectedInstance" class="instance-view">
        <div ref="loopLogRef" class="loop-log" tabindex="0" @keydown="handleLogKeydown">
          <div v-if="selectedInstance.messages.length === 0" class="empty">No messages yet.</div>
          <div
            v-for="(msg, index) in selectedMessages"
            :key="msg.id"
            class="message-line"
            :class="[msg.kind, { focused: index === focusedLogIndex, collapsed: !expandedLogIds.has(msg.id) }]"
            @click="focusedLogIndex = index"
          >
            <span class="time">{{ new Date(msg.timestamp).toLocaleTimeString(undefined, { hour12: false }) }}</span>
            <span class="kind">{{ msg.kind }}</span>
            <span class="content">{{ msg.content }}</span>
          </div>
        </div>

        <div class="activity-line">{{ selectedInstance.currentActivity || selectedInstance.status }}</div>

        <form class="human-input" @submit.prevent="sendHumanMessage">
          <input
            v-model="humanMessage"
            :placeholder="selectedInstance.status === 'waiting_for_human' ? 'Answer the loop...' : 'Send an intent interception...'"
          >
          <button class="primary-btn" :disabled="!humanMessage.trim()">Send</button>
        </form>
      </div>

      <div v-else class="empty-main">Create an instance to run this loop.</div>
    </section>
  </div>
</template>

<style scoped>
.loop-panel {
  display: grid;
  grid-template-columns: 12rem 14rem minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  background: #171717;
  color: #ddd;
}

.column {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid #333;
  padding: 0.5rem;
  gap: 0.35rem;
  overflow-y: auto;
}

.nav-item,
.add-item,
.action-btn,
.primary-btn,
.danger-btn {
  height: 1.75rem;
  border: 1px solid #3a3a3a;
  border-radius: 0.25rem;
  background: #222;
  color: #eee;
  padding: 0 0.65rem;
  line-height: 1;
  cursor: pointer;
}

.nav-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  text-align: left;
  padding: 0 0.5rem;
}

.nav-item.active {
  border-color: #007acc;
  background: #24384a;
}

.instance-item small {
  color: #999;
}

.add-item {
  margin-top: auto;
  font-size: 1.2rem;
}

.main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.main-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 2.6rem;
  border-bottom: 1px solid #333;
  padding: 0 0.75rem;
  gap: 0.75rem;
}

.header-main {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
  flex: 1;
  overflow: hidden;
}

.instance-name-input {
  width: min(15rem, 24%);
  min-width: 7rem;
  font-weight: 700;
  border-color: transparent;
  background: transparent;
  padding-left: 0;
}

.target-chip {
  max-width: 16rem;
  min-height: 1.75rem;
  border: 1px solid #3a3a3a;
  border-radius: 0.25rem;
  background: #202020;
  color: #ddd;
  padding: 0 0.5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.aim-chip {
  max-width: min(24rem, 36%);
}

.header-btn {
  flex: 0 0 auto;
}

.stop-policy {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  color: #999;
  font-size: 0.78rem;
  white-space: nowrap;
}

.stop-policy select {
  min-height: 1.75rem;
  padding: 0 0.4rem;
  max-width: 8rem;
}

.config-view {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-height: 0;
  padding: 0.75rem;
  overflow: auto;
}

.instance-view {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  background: #080808;
  overflow: hidden;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.82rem;
}

input,
select,
textarea {
  border: 1px solid #444;
  border-radius: 0.25rem;
  background: #101010;
  color: #eee;
  padding: 0.45rem 0.5rem;
}

textarea {
  resize: vertical;
  font-family: inherit;
}

.provider-grid {
  display: grid;
  grid-template-columns: minmax(10rem, 14rem) minmax(12rem, 1fr);
  gap: 0.75rem;
}

.wide {
  grid-column: 1 / -1;
}

.hint,
.message,
.empty,
.empty-main {
  color: #999;
  font-size: 0.85rem;
}

em,
.secret-state {
  color: #8fd18f;
  font-style: normal;
}

.secret-state.missing {
  color: #ffcc66;
}

.config-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.primary-btn {
  background: #005fa3;
  border-color: #007acc;
}

.danger-btn {
  background: #3a1e1e;
  border-color: #8b3a3a;
}

.loop-log {
  flex: 1;
  min-height: 0;
  background: #080808;
  padding: 0.75rem;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.82rem;
  outline: none;
}

.message-line {
  display: grid;
  grid-template-columns: 5rem 4.5rem minmax(0, 1fr);
  gap: 0.5rem;
  padding: 0.2rem 0;
  min-width: 0;
}

.message-line.focused {
  background: rgba(255, 255, 255, 0.06);
  outline: 1px solid #3a3a3a;
}

.message-line.collapsed .content {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.message-line:not(.collapsed) .content {
  white-space: pre-wrap;
  overflow: visible;
}

.time,
.kind {
  color: #777;
}

.message-line.status .content {
  color: #ffcc66;
}

.message-line.error .content {
  color: #f88;
}

.message-line.human_action_required .content {
  color: #ffd166;
  font-weight: 700;
}

.activity-line {
  flex: 0 0 auto;
  margin: 0 0.75rem;
  padding: 0.35rem 0;
  border-top: 1px solid #222;
  color: #9fb7d7;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.78rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.human-input {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.5rem;
  margin: 0 0.75rem 0.75rem;
  padding-top: 0.75rem;
  background: #080808;
}

.human-input input {
  background: #101010;
}

.notify-dot {
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 999px;
  background: #ffd166;
  box-shadow: 0 0 0 2px rgba(255, 209, 102, 0.18);
  display: inline-block;
  flex: 0 0 auto;
}

.notify-dot.inline {
  width: 0.45rem;
  height: 0.45rem;
  margin-right: 0.25rem;
}

.waiting-note {
  margin-left: 0.6rem;
  color: #ffd166;
  font-size: 0.8rem;
}

@media (max-width: 850px) {
  .loop-panel {
    grid-template-columns: 8rem 10rem minmax(0, 1fr);
  }
}
</style>
