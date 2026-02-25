<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useGraphUIStore } from '../stores/ui/graph-store'
import { useProjectStore } from '../stores/project-store'
import { useDataStore } from '../stores/data'
import { useMapStore } from '../stores/map'
import { trpc } from '../trpc'
import type { Aim, Connection } from 'shared/src/types'
import { formatWithK, parseK } from '../utils/number-format'

const graphUIStore = useGraphUIStore()
const projectStore = useProjectStore()
const dataStore = useDataStore()
const mapStore = useMapStore()

const selectedAim = computed(() => {
    if (!graphUIStore.graphSelectedAimId) return null
    return dataStore.aims[graphUIStore.graphSelectedAimId] || null
})

const selectedLink = computed(() => {
    if (!graphUIStore.selectedLink) return null
    const { parentId, childId } = graphUIStore.selectedLink
    const parent = dataStore.aims[parentId]
    const child = dataStore.aims[childId]
    if (!parent || !child) return null

    const connection = parent.supportingConnections?.find((c: any) => c.aimId === childId)
    if (!connection) return null

    return {
        parent,
        child,
        connection
    }
})

const statusColor = computed(() => {
    if (!selectedAim.value) return '#888'
    const colorMap: Record<string, string> = {}
    dataStore.getStatuses.forEach((s: any) => {
        colorMap[s.key] = s.color
    })
    return colorMap[selectedAim.value.status.state] ?? '#888'
})

// Editing state
const isEditingExplanation = ref(false)
const editedExplanation = ref('')
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
    editedExplanation.value = link.connection.explanation || ''
    editedWeight.value = link.connection.weight
    isConfirmingDelete.value = false
}

watch(selectedLink, (newVal) => {
    if (newVal) {
        if (!isEditingExplanation.value) {
            syncEditedConnectionFields(newVal)
            editingConnectionRef.value = {
                parentId: newVal.parent.id,
                childId: newVal.child.id
            }
        }
    }
}, { immediate: true })

watch(selectedAim, (newVal) => {
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

const focusAim = (aimId: string) => {
    const node = mapStore.getNode(aimId)
    if (node) {
        graphUIStore.setGraphSelection(aimId)
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

const updateAimAttributes = async () => {
    if (!selectedAim.value) return
    const aimId = selectedAim.value.id
    
    // Optimistic Update
    const updates = {
        intrinsicValue: editedIntrinsicValue.value,
        cost: editedCost.value,
        loopWeight: editedLoopWeight.value
    }
    
    const updatedAim = { ...selectedAim.value, ...updates }
    dataStore.replaceAim(aimId, updatedAim)
    dataStore.recalculateValues()
    
    // Persist
    try {
        await trpc.aim.update.mutate({
            projectPath: projectStore.projectPath,
            aimId,
            aim: updates
        })
    } catch (e) {
        console.error('Failed to update aim attributes', e)
    }
}

const focusConnection = (parentId: string, childId: string) => {
    graphUIStore.selectLink(parentId, childId)
    graphUIStore.setGraphSelection(null)
    mapStore.centerOnConnection(parentId, childId)
}

const resolveConnection = (linkRef?: { parentId: string, childId: string } | null) => {
    if (linkRef) {
        const parent = dataStore.aims[linkRef.parentId]
        const child = dataStore.aims[linkRef.childId]
        if (!parent || !child) return null
        const connection = parent.supportingConnections?.find((c: any) => c.aimId === child.id)
        if (!connection) return null
        return { parent, child, connection }
    }

    if (!selectedLink.value) return null
    return selectedLink.value
}

const startEditingExplanation = () => {
    if (!selectedLink.value) return
    editingConnectionRef.value = {
        parentId: selectedLink.value.parent.id,
        childId: selectedLink.value.child.id
    }
    editedExplanation.value = selectedLink.value.connection.explanation || ''
    isEditingExplanation.value = true
}

const updateConnection = async (options?: { linkRef?: { parentId: string, childId: string } | null, closeEditor?: boolean }) => {
    const resolved = resolveConnection(options?.linkRef)
    if (!resolved) return

    const { parent, child, connection } = resolved
    const closeEditor = options?.closeEditor ?? false
    
    // Optimistic update
    const updatedConnections = parent.supportingConnections.map((c: any) => {
        if (c.aimId === child.id) {
            return { 
                ...c, 
                weight: editedWeight.value,
                explanation: editedExplanation.value 
            }
        }
        return c
    })

    const updatedParent = {
        ...parent,
        supportingConnections: updatedConnections
    }

    // Local update
    dataStore.replaceAim(parent.id, updatedParent)
    dataStore.recalculateValues()
    if (closeEditor) {
        isEditingExplanation.value = false
        editingConnectionRef.value = null
    }

    // Backend update
    try {
        await trpc.aim.update.mutate({
            projectPath: projectStore.projectPath,
            aimId: parent.id,
            aim: {
                supportingConnections: updatedConnections
            }
        })
    } catch (e) {
        console.error('Failed to update connection', e)
    } finally {
        if (closeEditor && selectedLink.value) {
            syncEditedConnectionFields(selectedLink.value)
        }
    }
}

const saveEditedExplanation = async () => {
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

    // Optimistic update
    const updatedConnections = parent.supportingConnections.filter((c: any) => c.aimId !== child.id)
    const updatedParent = { ...parent, supportingConnections: updatedConnections }
    
    const updatedChildSupported = child.supportedAims.filter((id: string) => id !== parent.id)
    const updatedChild = { ...child, supportedAims: updatedChildSupported }

    dataStore.replaceAim(parent.id, updatedParent)
    dataStore.replaceAim(child.id, updatedChild)
    dataStore.recalculateValues()
    graphUIStore.deselectLink()
    isConfirmingDelete.value = false

    try {
        await trpc.aim.update.mutate({
            projectPath: projectStore.projectPath,
            aimId: parent.id,
            aim: { supportingConnections: updatedConnections }
        })
        await trpc.aim.update.mutate({
            projectPath: projectStore.projectPath,
            aimId: child.id,
            aim: { supportedAims: updatedChildSupported }
        })
    } catch (e) {
        console.error('Failed to remove connection', e)
    }
}

const getSupportedAims = (aim: Aim) => {
    return aim.supportedAims.map((id: string) => dataStore.aims[id]).filter(Boolean) as Aim[]
}

const getSupportingAims = (aim: Aim) => {
    return aim.supportingConnections.map((c: any) => dataStore.aims[c.aimId]).filter(Boolean) as Aim[]
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

watch([selectedAim, selectedLink], () => {
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
        v-if="selectedAim || selectedLink"
        :style="{ width: panelWidth + 'px' }"
        :class="{ opaque: isOpaque }"
    >
        <div class="resize-handle" @mousedown="startResize"></div>

        <!-- CONNECTION SELECTED -->
        <div v-if="selectedLink" class="panel-content">
            <h3>Connection</h3>
            
            <div class="aim-buttons">
                <button class="aim-card source" @click="focusAim(selectedLink.parent.id)">
                    <span class="label">From (Child)</span>
                    <span class="text">{{ selectedLink.parent.text }}</span>
                </button>
                <div class="arrow">↓</div>
                <button class="aim-card target" @click="focusAim(selectedLink.child.id)">
                    <span class="label">To (Parent)</span>
                    <span class="text">{{ selectedLink.child.text }}</span>
                </button>
            </div>

            <div class="field-group">
                <label>Weight</label>
                <input type="number" v-model.number="editedWeight" @change="onWeightChange" step="0.1" min="0" class="input-field" />
            </div>

            <div class="field-group">
                <label>Explanation</label>
                <div v-if="!isEditingExplanation" class="explanation-view" @click="startEditingExplanation">
                    {{ selectedLink.connection.explanation || 'Add explanation...' }}
                </div>
                <textarea 
                    v-else 
                    v-model="editedExplanation" 
                    @blur="saveEditedExplanation" 
                    placeholder="Why does it support?"
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

        <!-- AIM SELECTED -->
        <div v-else-if="selectedAim" class="panel-content">
            <h3>{{ selectedAim.text }}</h3>
            <div class="aim-status" :style="{ color: statusColor }">{{ selectedAim.status.state }}</div>
            
            <div class="metrics-section">
                <h4>Value</h4>
                <div class="metrics-row">
                    <div class="metric">
                        <span class="label">Intrinsic</span>
                        <input
                            type="text"
                            v-model="editedIntrinsicValueStr"
                            @input="onIntrinsicValueInput"
                            @change="updateAimAttributes"
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
                            @change="updateAimAttributes"
                            class="value-input"
                            placeholder="e.g. 5k"
                        />
                    </div>
                    <div class="metric">
                        <span class="label">Total</span>
                        <span class="value highlight">{{ formatWithK(dataStore.getAimValue(selectedAim.id)) }}</span>
                    </div>
                </div>
            </div>

            <div class="metrics-section">
                <h4>Cost</h4>
                <div class="metrics-row">
                    <div class="metric">
                        <span class="label">Intrinsic</span>
                        <input
                            type="text"
                            v-model="editedCostStr"
                            @input="onCostInput"
                            @change="updateAimAttributes"
                            class="value-input"
                            placeholder="e.g. 2k, 500"
                        />
                    </div>
                    <div class="metric">
                        <span class="label">Total</span>
                        <span class="value">{{ formatWithK(dataStore.getAimCost(selectedAim.id)) }}</span>
                    </div>
                    <div class="metric">
                        <span class="label">Progress</span>
                        <span class="value">{{ dataStore.getAimProgress(selectedAim.id).toFixed(0) }}%</span>
                    </div>
                </div>
            </div>
            
            <div v-if="selectedAim.description" class="aim-description">
                {{ selectedAim.description }}
            </div>
            
            <div class="section">
                <h4>Supported Aims (Parents)</h4>
                <div class="list">
                    <div 
                        v-for="parent in getSupportedAims(selectedAim)" 
                        :key="parent.id"
                        class="aim-card clickable"
                        @click="focusConnection(parent.id, selectedAim!.id)"
                    >
                        {{ parent.text }}
                    </div>
                    <div v-if="getSupportedAims(selectedAim).length === 0" class="empty">None</div>
                </div>
            </div>

            <div class="section">
                <h4>Supporting Aims (Children)</h4>
                <div class="list">
                    <div 
                        v-for="child in getSupportingAims(selectedAim)" 
                        :key="child.id"
                        class="aim-card clickable"
                        @click="focusConnection(selectedAim!.id, child.id)"
                    >
                        {{ child.text }}
                    </div>
                    <div v-if="getSupportingAims(selectedAim).length === 0" class="empty">None</div>
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

.aim-description {
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

.aim-buttons {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 1rem;
    align-items: center;
}

.aim-card {
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

.aim-card.clickable {
    cursor: pointer;
}

.aim-card.clickable:hover, button.aim-card:hover {
    background: #333;
    border-color: #444;
}

/* Specific styles for connection buttons which are now aim-cards */
button.aim-card {
    cursor: pointer;
    display: flex;
    flex-direction: column;
    /* Reset button styles */
    border-style: solid; /* Explicitly set border style to match div */
    font-size: inherit;
    font-family: inherit;
}

.aim-card .label {
    font-size: 0.8em;
    color: #888;
    margin-bottom: 0.2rem;
    display: block;
}

.aim-card .text {
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

.explanation-view {
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

.aim-status {
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
