<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useGraphUIStore } from '../stores/ui/graph-store'
import { useProjectStore } from '../stores/project-store'
import { useDataStore } from '../stores/data'
import { useMapStore } from '../stores/map'
import type { Idea, Connection } from 'shared'
import { formatWithK, parseK } from '../utils/number-format'
import NumericTextInput from './NumericTextInput.vue'

const graphUIStore = useGraphUIStore()
const projectStore = useProjectStore()
const dataStore = useDataStore()
const mapStore = useMapStore()

const selectedIdea = computed(() => {
    if (!graphUIStore.graphSelectedIdeaId) return null
    return dataStore.ideas[graphUIStore.graphSelectedIdeaId] || null
})

const selectedLink = computed(() => {
    if (!graphUIStore.selectedLink) return null
    const { parentId, childId } = graphUIStore.selectedLink
    const parent = dataStore.ideas[parentId]
    const child = dataStore.ideas[childId]
    if (!parent || !child) return null

    const connection = parent.supportingConnections?.find((c: any) => c.ideaId === childId)
    if (!connection) return null

    return {
        parent,
        child,
        connection
    }
})

const statusColor = computed(() => {
    if (!selectedIdea.value) return '#888'
    const colorMap: Record<string, string> = {}
    dataStore.getStatuses.forEach((s: any) => {
        colorMap[s.key] = s.color
    })
    return colorMap[selectedIdea.value.status.state] ?? '#888'
})

// Editing state
type ConnectionTextField = 'hypothesis' | 'evaluation'
const editingTextField = ref<ConnectionTextField | null>(null)
const editedHypothesis = ref('')
const editedEvaluation = ref('')
const editedWeight = ref(1)
const isConfirmingDelete = ref(false)
const editingConnectionRef = ref<{ parentId: string, childId: string } | null>(null)

const editedIntrinsicValue = ref(0)
const editedCost = ref(0)
const editedLoopWeight = ref(0)

// String versions for k-notation input
const editedIntrinsicValueStr = ref('0')
const editedCostStr = ref('0')
const editedLoopWeightStr = ref('0')

const syncEditedConnectionFields = (link: NonNullable<typeof selectedLink.value>) => {
    editedHypothesis.value = link.connection.hypothesis || ''
    editedEvaluation.value = link.connection.evaluation || ''
    editedWeight.value = link.connection.weight
    isConfirmingDelete.value = false
}

watch(selectedLink, (newVal) => {
    if (newVal) {
        if (!editingTextField.value) {
            syncEditedConnectionFields(newVal)
            editingConnectionRef.value = {
                parentId: newVal.parent.id,
                childId: newVal.child.id
            }
        }
    }
}, { immediate: true })

watch(selectedIdea, (newVal) => {
    if (newVal) {
        editedIntrinsicValue.value = newVal.intrinsicValue || 0
        editedCost.value = newVal.cost ?? 0
        editedLoopWeight.value = newVal.loopWeight ?? 0

        // Update string versions with formatting
        editedIntrinsicValueStr.value = editedIntrinsicValue.value.toString()
        editedCostStr.value = editedCost.value.toString()
        editedLoopWeightStr.value = editedLoopWeight.value.toString()
    }
}, { immediate: true })

const focusIdea = (ideaId: string) => {
    const node = mapStore.getNode(ideaId)
    if (node) {
        graphUIStore.setGraphSelection(ideaId)
        graphUIStore.deselectLink()
        mapStore.centerOnNode(node)
    }
}

// Input handlers for k-notation
const onIntrinsicValueInput = (event: Event) => {
    const input = (event.target as HTMLInputElement).value
    editedIntrinsicValue.value = parseK(input)
}

const onCostInput = (event: Event) => {
    const input = (event.target as HTMLInputElement).value
    editedCost.value = parseK(input)
}

const onLoopWeightInput = (event: Event) => {
    const input = (event.target as HTMLInputElement).value
    editedLoopWeight.value = parseK(input)
}

const updateIdeaAttributes = async () => {
    if (!selectedIdea.value) return
    const ideaId = selectedIdea.value.id
    const updates = {
        intrinsicValue: editedIntrinsicValue.value,
        cost: editedCost.value,
        loopWeight: editedLoopWeight.value
    }

    try {
        await dataStore.updateIdea(projectStore.projectPath, ideaId, updates)
    } catch (e) {
        console.error('Failed to update idea attributes', e)
    }
}

const focusConnection = (parentId: string, childId: string) => {
    graphUIStore.selectLink(parentId, childId)
    graphUIStore.setGraphSelection(null)
    mapStore.centerOnConnection(parentId, childId)
}

const resolveConnection = (linkRef?: { parentId: string, childId: string } | null) => {
    if (linkRef) {
        const parent = dataStore.ideas[linkRef.parentId]
        const child = dataStore.ideas[linkRef.childId]
        if (!parent || !child) return null
        const connection = parent.supportingConnections?.find((c: any) => c.ideaId === child.id)
        if (!connection) return null
        return { parent, child, connection }
    }

    if (!selectedLink.value) return null
    return selectedLink.value
}

const startEditingTextField = (field: ConnectionTextField) => {
    if (!selectedLink.value) return
    editingConnectionRef.value = {
        parentId: selectedLink.value.parent.id,
        childId: selectedLink.value.child.id
    }
    syncEditedConnectionFields(selectedLink.value)
    editingTextField.value = field
}

const updateConnection = async (options?: { linkRef?: { parentId: string, childId: string } | null, closeEditor?: boolean }) => {
    const resolved = resolveConnection(options?.linkRef)
    if (!resolved) return

    const { parent, child } = resolved
    const closeEditor = options?.closeEditor ?? false
    
    if (closeEditor) {
        editingTextField.value = null
        editingConnectionRef.value = null
    }

    // Backend update
    try {
        await dataStore.updateConnectionDetails(projectStore.projectPath, parent.id, child.id, {
            weight: editedWeight.value,
            hypothesis: editedHypothesis.value.trim() || undefined,
            evaluation: editedEvaluation.value.trim() || undefined
        })
    } catch (e) {
        console.error('Failed to update connection', e)
    } finally {
        if (closeEditor && selectedLink.value) {
            syncEditedConnectionFields(selectedLink.value)
        }
    }
}

const saveEditedTextField = async () => {
    await updateConnection({
        linkRef: editingConnectionRef.value,
        closeEditor: true
    })
}

const onWeightChange = async () => {
    await updateConnection()
}

const removeConnection = async () => {
    if (!isConfirmingDelete.value) {
        isConfirmingDelete.value = true
        return
    }

    if (!selectedLink.value) return
    const { parent, child } = selectedLink.value

    graphUIStore.deselectLink()
    isConfirmingDelete.value = false

    try {
        await dataStore.removeConnection(projectStore.projectPath, parent.id, child.id)
    } catch (e) {
        console.error('Failed to remove connection', e)
    }
}

const getSupportedIdeas = (idea: Idea) => {
    return idea.supportedIdeas.map((id: string) => dataStore.ideas[id]).filter(Boolean) as Idea[]
}

const getSupportingIdeas = (idea: Idea) => {
    return idea.supportingConnections.map((c: any) => dataStore.ideas[c.ideaId]).filter(Boolean) as Idea[]
}

const vFocus = {
  mounted: (el: HTMLElement) => el.focus()
}

// Resizing logic
const panelWidth = computed(() => graphUIStore.graphPanelWidth)
const isResizing = ref(false)

const startResize = (e: MouseEvent) => {
    e.preventDefault()
    isResizing.value = true
    window.addEventListener('mousemove', onResize)
    window.addEventListener('mouseup', stopResize)
}

const onResize = (e: MouseEvent) => {
    if (isResizing.value) {
        // Resize from left edge (panel is on right)
        // Width = Window Width - Mouse X - Right Margin (20)
        const newWidth = window.innerWidth - e.clientX - 20
        graphUIStore.setGraphPanelWidth(newWidth)
    }
}

const stopResize = () => {
    isResizing.value = false
    window.removeEventListener('mousemove', onResize)
    window.removeEventListener('mouseup', stopResize)
}

// Interaction tracking for opacity
const hasInteracted = ref(false)

watch([selectedIdea, selectedLink], () => {
    hasInteracted.value = false
})

watch(() => [
    mapStore.panBeginning,
    mapStore.dragBeginning,
    mapStore.layouting,
    mapStore.connecting,
    mapStore.scale
], ([pan, drag, layout, connect, scale], [oldPan, oldDrag, oldLayout, oldConnect, oldScale]) => {
    const isInteracting = !!pan || !!drag || layout || connect
    const isZooming = scale !== oldScale
    if (isInteracting || isZooming) {
        hasInteracted.value = true
    }
})

const isOpaque = computed(() => !hasInteracted.value)

</script>

<template>
    <div 
        class="side-panel" 
        v-if="selectedIdea || selectedLink"
        :style="{ width: panelWidth + 'px' }"
        :class="{ opaque: isOpaque }"
    >
        <div class="resize-handle" @mousedown="startResize"></div>

        <!-- CONNECTION SELECTED -->
        <div v-if="selectedLink" class="panel-content">
            <h3>Connection</h3>
            
            <div class="idea-buttons">
                <button class="idea-card source" @click="focusIdea(selectedLink.parent.id)">
                    <span class="label">From (Child)</span>
                    <span class="text">{{ selectedLink.parent.text }}</span>
                </button>
                <div class="arrow">↓</div>
                <button class="idea-card target" @click="focusIdea(selectedLink.child.id)">
                    <span class="label">To (Parent)</span>
                    <span class="text">{{ selectedLink.child.text }}</span>
                </button>
            </div>

            <div class="field-group">
                <label>Weight</label>
                <NumericTextInput v-model="editedWeight" @change="onWeightChange" class="input-field" />
            </div>

            <div class="field-group">
                <label>Hypothesis</label>
                <div v-if="editingTextField !== 'hypothesis'" class="hypothesis-view" @click="startEditingTextField('hypothesis')">
                    {{ selectedLink.connection.hypothesis || 'Add hypothesis...' }}
                </div>
                <textarea 
                    v-else 
                    v-model="editedHypothesis" 
                    @blur="saveEditedTextField" 
                    placeholder="Why should it contribute?"
                    class="input-field"
                    v-focus
                ></textarea>
            </div>

            <div class="field-group">
                <label>Evaluation</label>
                <div v-if="editingTextField !== 'evaluation'" class="hypothesis-view evaluation-view" @click="startEditingTextField('evaluation')">
                    {{ selectedLink.connection.evaluation || 'Add evaluation...' }}
                </div>
                <textarea 
                    v-else 
                    v-model="editedEvaluation" 
                    @blur="saveEditedTextField" 
                    placeholder="How did it actually contribute?"
                    class="input-field"
                    v-focus
                ></textarea>
            </div>

            <button 
                class="danger-btn" 
                :class="{ confirm: isConfirmingDelete }"
                @click="removeConnection"
                @blur="isConfirmingDelete = false"
            >
                {{ isConfirmingDelete ? 'Confirm Remove' : 'Remove Connection' }}
            </button>
        </div>

        <!-- IDEA SELECTED -->
        <div v-else-if="selectedIdea" class="panel-content">
            <h3>{{ selectedIdea.text }}</h3>
            <div class="idea-status" :style="{ color: statusColor }">{{ selectedIdea.status.state }}</div>
            
            <div class="metrics-section">
                <h4>Value</h4>
                <div class="metrics-row">
                    <div class="metric">
                        <span class="label">Intrinsic</span>
                        <input
                            type="text"
                            v-model="editedIntrinsicValueStr"
                            @input="onIntrinsicValueInput"
                            @change="updateIdeaAttributes"
                            class="value-input"
                            placeholder="e.g. 10k, 1500"
                        />
                    </div>
                    <div class="metric">
                        <span class="label">Loop</span>
                        <input
                            type="text"
                            v-model="editedLoopWeightStr"
                            @input="onLoopWeightInput"
                            @change="updateIdeaAttributes"
                            class="value-input"
                            placeholder="e.g. 5k"
                        />
                    </div>
                    <div class="metric">
                        <span class="label">Total</span>
                        <span class="value highlight">{{ formatWithK(dataStore.getIdeaValue(selectedIdea.id)) }}</span>
                    </div>
                </div>
            </div>

            <div class="metrics-section">
                <h4>Cost<template v-if="dataStore.costUnit"> ({{ dataStore.costUnit }})</template></h4>
                <div class="metrics-row">
                    <div class="metric">
                        <span class="label">Intrinsic</span>
                        <input
                            type="text"
                            v-model="editedCostStr"
                            @input="onCostInput"
                            @change="updateIdeaAttributes"
                            class="value-input"
                            placeholder="e.g. 2k, 500"
                        />
                    </div>
                    <div class="metric">
                        <span class="label">Total</span>
                        <span class="value">{{ formatWithK(dataStore.getIdeaCost(selectedIdea.id)) }}</span>
                    </div>
                    <div class="metric">
                        <span class="label">Progress</span>
                        <span class="value">{{ dataStore.getIdeaProgress(selectedIdea.id).toFixed(0) }}%</span>
                    </div>
                </div>
            </div>
            
            <div v-if="selectedIdea.description" class="idea-description">
                {{ selectedIdea.description }}
            </div>
            
            <div class="section">
                <h4>Supported Ideas (Parents)</h4>
                <div class="list">
                    <div 
                        v-for="parent in getSupportedIdeas(selectedIdea)" 
                        :key="parent.id"
                        class="idea-card clickable"
                        @click="focusConnection(parent.id, selectedIdea!.id)"
                    >
                        {{ parent.text }}
                    </div>
                    <div v-if="getSupportedIdeas(selectedIdea).length === 0" class="empty">None</div>
                </div>
            </div>

            <div class="section">
                <h4>Supporting Ideas (Children)</h4>
                <div class="list">
                    <div 
                        v-for="child in getSupportingIdeas(selectedIdea)" 
                        :key="child.id"
                        class="idea-card clickable"
                        @click="focusConnection(selectedIdea!.id, child.id)"
                    >
                        {{ child.text }}
                    </div>
                    <div v-if="getSupportingIdeas(selectedIdea).length === 0" class="empty">None</div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.side-panel {
    position: absolute;
    right: 20px;
    top: 20px;
    bottom: 20px;
    background: #1e1e1e; 
    border: 1px solid #333;
    border-radius: 8px;
    color: inherit; 
    font-size: 1rem; 
    opacity: 0.3;
    transition: opacity 0.2s;
    display: flex; 
    flex-direction: row; 
    overflow: hidden; 
}

.side-panel:hover, .side-panel:focus-within, .side-panel:active, .side-panel.opaque {
    opacity: 1;
}

.panel-content {
    flex: 1;
    overflow-y: auto; 
    padding: 1rem; 
    padding-left: 0.5rem; 
}

.header-group {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    margin-bottom: 0.5rem;
}

.metrics-row {
    display: flex;
    gap: 1rem;
    margin-bottom: 1rem;
    padding: 0.5rem;
    background: #252525;
    border-radius: 4px;
    justify-content: space-around;
}

.metric {
    display: flex;
    flex-direction: column;
    align-items: center;
}

.metric .label {
    font-size: 0.75em;
    color: #888;
    margin-bottom: 0.2rem;
    text-transform: uppercase;
}

.metric .value {
    font-family: monospace;
    font-size: 0.9em;
    color: #eee;
}

.metric .value-input {
    font-family: monospace;
    font-size: 0.9em;
    color: #eee;
    background: transparent;
    border: 1px solid transparent;
    border-bottom: 1px solid #444;
    width: 4rem;
    text-align: center;
    padding: 0.1rem;
}

.metric .value-input:focus {
    border-color: #007acc;
    outline: none;
    background: #333;
}

/* Hide number spinners */
.metric .value-input::-webkit-outer-spin-button,
.metric .value-input::-webkit-inner-spin-button,
.input-field::-webkit-outer-spin-button,
.input-field::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.metric .value-input[type=number],
.input-field[type=number] {
  -moz-appearance: textfield;
}

.metric .value.highlight {
    color: #4fc3f7;
    font-weight: bold;
}

h3 {
    margin: 0;
    margin-bottom: 0.5rem;
    font-size: 1rem; 
    font-weight: 600;
    color: inherit;
    word-break: break-word;
    line-height: 1.4;
}

/* Removed old .value-badge styles */

.idea-description {
    font-size: 0.8rem;
    color: #aaa;
    margin-bottom: 1.5rem;
    line-height: 1.5;
    white-space: pre-wrap;
}

h4 {
    margin: 0.8rem 0 0.5rem;
    font-size: 0.85em;
    color: #888; 
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.idea-buttons {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 1rem;
    align-items: center;
}

.idea-card {
    display: block;
    width: 100%;
    padding: 0.4rem; /* Reduced from 0.8rem */
    background: #252525;
    border: 1px solid #333;
    border-radius: 6px;
    color: inherit;
    text-align: left;
    transition: background 0.2s, border-color 0.2s;
    font-size: 0.95rem;
    font-family: inherit; /* Ensure font inheritance */
}

.idea-card.clickable {
    cursor: pointer;
}

.idea-card.clickable:hover, button.idea-card:hover {
    background: #333;
    border-color: #444;
}

/* Specific styles for connection buttons which are now idea-cards */
button.idea-card {
    cursor: pointer;
    display: flex;
    flex-direction: column;
    /* Reset button styles */
    border-style: solid; /* Explicitly set border style to match div */
    font-size: inherit;
    font-family: inherit;
}

.idea-card .label {
    font-size: 0.8em;
    color: #888;
    margin-bottom: 0.2rem;
    display: block;
}

.idea-card .text {
    font-weight: 500;
}

.arrow {
    color: #666;
}

/* ... existing field/button styles ... */

.field-group {
    margin-bottom: 1rem;
}

.field-group label {
    display: block;
    font-size: 0.9em;
    color: #888;
    margin-bottom: 0.4rem;
}

.input-field {
    width: 100%;
    background: #252525;
    border: 1px solid #444;
    color: inherit;
    padding: 0.5rem;
    border-radius: 4px;
    font-size: inherit;
}

textarea.input-field {
    min-height: 5rem;
    resize: vertical;
}

.hypothesis-view {
    padding: 0.5rem;
    background: #252525;
    border: 1px solid #444;
    border-radius: 4px;
    cursor: text;
    min-height: 2.5rem;
    color: #ccc;
    font-size: 0.9em;
}

.list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem; /* Increased gap for cards */
}

.empty {
    color: #666;
    font-style: italic;
    font-size: 0.9em;
    padding: 0.5rem;
}

.danger-btn {
    width: 100%;
    padding: 0.6rem;
    background: #3a1a1a;
    border: 1px solid #5a2a2a;
    color: #ff6666;
    border-radius: 4px;
    cursor: pointer;
    margin-top: 0.5rem;
    transition: background 0.2s;
}

.danger-btn:hover {
    background: #4a1a1a;
}

.danger-btn.confirm {
    background: #ff4444;
    color: white;
    border-color: #ff0000;
}

.resize-handle {
    position: relative; 
    width: 15px; 
    cursor: ew-resize;
    background: transparent;
    transition: background 0.2s;
    flex-shrink: 0;
    top: 0; bottom: 0; left: 0; 
}

.resize-handle:hover, .side-panel:hover .resize-handle {
    background: rgba(255, 255, 255, 0.05);
}

.idea-status {
    font-size: 0.85rem;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 1rem;
    margin-top: -0.25rem;
}

.metrics-section {
    margin-bottom: 1rem;
}

.metrics-section h4 {
    margin: 0 0 0.5rem 0;
    font-size: 0.8rem;
    color: #aaa;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 1px solid #333;
    padding-bottom: 0.2rem;
}
</style>
