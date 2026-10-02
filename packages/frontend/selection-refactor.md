# Selection Refactoring - Path-Based Selection Model

## Context
The current selection system uses a global `selectedAim` object with `ideaId` to track which idea is selected. This creates complexity when navigating nested sub-ideas and handling deletion. We're refactoring to a **path-based selection model** where selection flows down the tree via indices.

## Goal
Remove redundant `ideaId` tracking and use implicit path-based selection that follows the data structure:
- Column → Phase → Top-level idea → Sub-idea (via indices)

## Current vs New Model

### Old (Current):
```typescript
// UI Store
selectedAim: { phaseId: string, ideaIndex: number, ideaId?: string } | null
lastSelectedRootAimIndex: number
lastSelectedAimIndexByPhase: Record<string, number>

// Selection determined by:
uiStore.selectedAim?.ideaId === idea.id
```

### New (Target):
```typescript
// UI Store
mode: 'column-navigation' | 'ideas-edit' | 'idea-edit'
rootAimsSelectedIndex: number  // For column -1

// Data Store - Phase type (UI-only properties)
phase.selectedAimIndex?: number

// Data Store - Idea type (already exists)
idea.selectedIncomingIndex?: number

// Selection path reconstruction:
// 1. Root ideas: rootAimsSelectedIndex → ideas[index].selectedIncomingIndex → recurse
// 2. Phase ideas: selectedPhaseByColumn[col] → phase.selectedAimIndex → ideas[index].selectedIncomingIndex → recurse

// Selection determined by checking if index matches parent's selection
```

## Completed Work ✅ (Updated)

### 1. Type Definitions (data.ts)
- ✅ Extended Phase type with `selectedAimIndex?: number`
- ✅ Extended Idea type already had `selectedIncomingIndex?: number`

### 2. UI Store State (ui.ts)
- ✅ Changed mode type: `'phase-edit'` → `'ideas-edit'`
- ✅ Added `rootAimsSelectedIndex: number`
- ⚠️ Removed `lastSelectedRootAimIndex` and `lastSelectedAimIndexByPhase`
- ⚠️ `selectedAim` object still exists but mostly unused (7 remaining references)

### 3. Mode String Updates
- ✅ Updated all `'phase-edit'` → `'ideas-edit'` in:
  - ui.ts: mode checks, setMode calls, handlePhaseEditKeys → handleAimsEditKeys
  - App.vue: keyboard hints watch
  - data.ts: comment in deletion logic

### 4. Helper Methods (ui.ts)
- ✅ Added `getCurrentAimContext(dataStore)` - returns phaseId, idea, ideaIndex
- ✅ Added `setCurrentAimIndex(ideaIndex, dataStore)` - sets appropriate index

### 5. handleAimsEditKeys Method (ui.ts)
- ✅ Refactored to use `context = getCurrentAimContext(dataStore)`
- ✅ Escape key: No longer calls setSelectedAim, indices stay in place
- ✅ o/O keys: Uses context.idea, context.ideaIndex
- ✅ j/k navigation: Uses setCurrentAimIndex, updates selectedIncomingIndex
- ✅ e/d/h/l keys: All use context.idea

### 6. handleColumnNavigationKeys Method (ui.ts)
- ✅ 'i' key: Sets index via setCurrentAimIndex, uses phase.selectedAimIndex
- ✅ 'j'/'k' keys in root column: Updates rootAimsSelectedIndex

### 7. Deletion Logic (data.ts)
- ✅ Gets deletedIndex from rootAimsSelectedIndex or phase.selectedAimIndex
- ✅ Sets new index after deletion to appropriate location
- ✅ Sub-idea deletion: Updates parent's selectedIncomingIndex

## Remaining Work 🚧 (Updated)

### Remaining selectedAim References (~7 in ui.ts)

**Locations:**
1. Line 1008-1012: `setSelectedAim` method definition - CAN BE REMOVED
2. Line 1055: `selectPhase` cascade restoration logic
3. Line 1073: `selectPhase` calls setSelectedAim
4. Line 1160, 1187: Comments about clearing selectedAim
5. Line 1207-1216: `clearPendingDelete` method saves selection

**Strategy:**
- Remove `setSelectedAim` method entirely
- Update `selectPhase` to not use selectedAim
- Update `clearPendingDelete` to use indices instead

### Critical: Component Selection Rendering

#### Pattern 1: Getting current idea in navigation/operations
**Old:**
```typescript
const currentAimId = selectedAim.ideaId || ideas[selectedAim.ideaIndex]?.id
```

**New (Root ideas):**
```typescript
if (selectedColumn === -1) {
  const ideas = dataStore.getAimsForPhase('null')
  const currentAim = ideas[rootAimsSelectedIndex]
}
```

**New (Phase ideas):**
```typescript
if (selectedColumn >= 0) {
  const phaseId = getSelectedPhaseId(selectedColumn)
  const phase = dataStore.phases[phaseId]
  const ideas = dataStore.getAimsForPhase(phaseId)
  const currentAim = ideas[phase.selectedAimIndex!]
}
```

#### Pattern 2: Mode checking
**Old:**
```typescript
if (selectedAim?.phaseId === phaseId) { ... }
```

**New:**
```typescript
if (mode === 'ideas-edit') {
  if (selectedColumn === -1) {
    // Root ideas editing
  } else {
    // Phase ideas editing
    const phaseId = getSelectedPhaseId(selectedColumn)
  }
}
```

#### Pattern 3: Entering ideas-edit mode
**Old:**
```typescript
setMode('ideas-edit')
setSelectedAim(phaseId, ideaIndex, idea?.id)
lastSelectedAimIndexByPhase[phaseId] = ideaIndex
```

**New (Root ideas):**
```typescript
setMode('ideas-edit')
rootAimsSelectedIndex = ideaIndex
```

**New (Phase ideas):**
```typescript
setMode('ideas-edit')
const phase = dataStore.phases[phaseId]
phase.selectedAimIndex = ideaIndex
```

#### Pattern 4: Exiting ideas-edit mode
**Old:**
```typescript
setMode('column-navigation')
setSelectedAim(null, null)
```

**New:**
```typescript
setMode('column-navigation')
// Indices stay in place (rootAimsSelectedIndex, phase.selectedAimIndex)
```

### Specific Files to Update

#### ui.ts - Key Methods

**handleAimsEditKeys (line 667):**
- Replace `const selectedAim = this.selectedAim` with helper to get current context
- Update all `selectedAim.phaseId`, `selectedAim.ideaIndex` references
- Update navigation (j/k) to update correct index:
  - Root: `this.rootAimsSelectedIndex`
  - Phase: `phase.selectedAimIndex`

**handleColumnNavigationKeys - 'i' key (line 504):**
- Update idea selection logic to set appropriate index instead of selectedAim

**o/O key handling (line 698):**
- Get current idea via index instead of selectedAim
- Update insertion index tracking

**Navigation helpers (findNextAimInTree, etc.):**
- These might still work as-is since they take ideaId and phaseId as parameters
- Call sites need updating to pass correct parameters

**setSelectedAim method (line 1008):**
- **Remove this method entirely** - replaced by setting indices directly
- Or refactor to `setAimSelection(columnIndex: number, ideaIndex: number)`

#### data.ts - Deletion Logic

**deleteAim method (line 319):**
- Line 324-326: Replace `deletedIndex` from `selectedAim.ideaIndex`
  ```typescript
  // Old
  const deletedIndex = uiStore.selectedAim?.phaseId === phaseId && uiStore.selectedAim?.ideaIndex !== undefined
    ? uiStore.selectedAim.ideaIndex : -1

  // New (Root)
  const deletedIndex = phaseId === 'null' ? uiStore.rootAimsSelectedIndex : -1

  // New (Phase)
  const phase = this.phases[phaseId]
  const deletedIndex = phase?.selectedAimIndex ?? -1
  ```

- Line 404-416: Update selection adjustment logic to set appropriate index
  ```typescript
  // Root ideas
  if (phaseId === 'null') {
    uiStore.rootAimsSelectedIndex = newIndex
  } else {
    // Phase ideas
    const phase = this.phases[phaseId]
    if (phase) {
      phase.selectedAimIndex = newIndex
    }
  }
  ```

#### Components - Selection Rendering

**Idea.vue (line 38-40):**
```typescript
// Old
const isThisAimSelected = computed(() => {
  return uiStore.selectedAim?.ideaId === props.idea.id
})

// New - need parent context passed as prop
// Parent tells child: "you are at index X, check if parent selected you"
const props = defineProps<{
  idea: Idea
  isSelected: boolean  // Computed by parent based on indices
  // ... other props
}>()
```

**IdeasList.vue (line 50-51):**
```typescript
// Old
'selected-outlined': isActive && uiStore.selectedAim?.ideaId === idea.id

// New - compute selection per idea
<IdeaComponent
  v-for="(idea, index) in ideas"
  :key="idea.id"
  :idea="idea"
  :is-selected="computeIsSelected(index, idea)"
  :class="{
    'selected-outlined': isActive && computeIsSelected(index, idea),
    // ...
  }"
/>

// Helper method
const computeIsSelected = (index: number, idea: Idea) => {
  if (uiStore.mode !== 'ideas-edit') return false

  if (uiStore.selectedColumn === -1) {
    // Root ideas: check if this is the selected top-level index
    if (index === uiStore.rootAimsSelectedIndex) {
      return !parentAim // Top-level
    }
    // Check if we're a selected sub-idea
    if (parentAim && parentAim.selectedIncomingIndex === indexInParent) {
      return true
    }
  } else {
    // Phase ideas: similar logic with phase.selectedAimIndex
    const phaseId = uiStore.getSelectedPhaseId(uiStore.selectedColumn)
    const phase = dataStore.phases[phaseId]
    if (index === phase?.selectedAimIndex) {
      return !parentAim
    }
    if (parentAim && parentAim.selectedIncomingIndex === indexInParent) {
      return true
    }
  }
  return false
}
```

**Better approach for components:**
Pass selection context down recursively:
- Top-level IdeasList receives phase/root context
- Computes which idea is selected at this level
- Passes `isSelected` prop to child Idea components
- Idea components pass selection context to nested IdeasList

### Helper Methods to Add

**ui.ts - getCurrentAimContext():**
```typescript
getCurrentAimContext(): { phaseId: string, idea: Idea, ideaIndex: number } | null {
  if (this.mode !== 'ideas-edit') return null

  if (this.selectedColumn === -1) {
    // Root ideas
    const ideas = dataStore.getAimsForPhase('null')
    const idea = ideas[this.rootAimsSelectedIndex]
    return idea ? { phaseId: 'null', idea, ideaIndex: this.rootAimsSelectedIndex } : null
  } else {
    // Phase ideas
    const phaseId = this.getSelectedPhaseId(this.selectedColumn)
    if (!phaseId) return null
    const phase = dataStore.phases[phaseId]
    const ideas = dataStore.getAimsForPhase(phaseId)
    const ideaIndex = phase?.selectedAimIndex ?? 0
    const idea = ideas[ideaIndex]
    return idea ? { phaseId, idea, ideaIndex } : null
  }
}
```

**ui.ts - setCurrentAimIndex(index: number):**
```typescript
setCurrentAimIndex(index: number) {
  if (this.selectedColumn === -1) {
    this.rootAimsSelectedIndex = index
  } else {
    const phaseId = this.getSelectedPhaseId(this.selectedColumn)
    if (phaseId) {
      const phase = dataStore.phases[phaseId]
      if (phase) {
        phase.selectedAimIndex = index
      }
    }
  }
}
```

## Testing Checklist

After refactoring, verify:

### Root Ideas Column
- [ ] Navigate with j/k between root ideas
- [ ] Press 'i' to enter ideas-edit mode on root idea
- [ ] Press 'o'/'O' to create idea above/below
- [ ] Expand idea with 'l', create sub-idea with 'o'
- [ ] Navigate sub-ideas with j/k
- [ ] Delete idea with 'd' twice - selection moves correctly
- [ ] Delete last sub-idea - selects parent
- [ ] Press Esc to exit back to column-navigation

### Phase Ideas
- [ ] Select phase, press 'i' to enter ideas-edit mode
- [ ] Navigate ideas with j/k
- [ ] Create ideas with o/O
- [ ] Expand and create sub-ideas
- [ ] Delete ideas - selection adjusts correctly
- [ ] Press Esc to return to column-navigation

### Cross-cutting
- [ ] Selection persists when switching between columns
- [ ] Selection restores when re-entering ideas-edit mode
- [ ] No console errors about undefined selectedAim
- [ ] Visual selection highlighting works correctly

## Key Principles

1. **Separation of concerns:**
   - Root ideas: Use `rootAimsSelectedIndex` in UI store
   - Phase ideas: Use `phase.selectedAimIndex` in data store
   - Sub-ideas: Use `idea.selectedIncomingIndex` (already working)

2. **Minimal code duplication:**
   - Check `selectedColumn === -1` to branch root vs phase logic
   - Use helper methods like `getCurrentAimContext()` for common patterns

3. **Selection is implicit path:**
   - No need to store `ideaId` - reconstruct from indices
   - Components determine if they're selected by checking their index against parent

4. **Indices persist across mode changes:**
   - Don't clear indices when exiting ideas-edit mode
   - This allows selection to restore when re-entering

## Common Pitfalls

1. **Don't forget sub-idea selection:**
   - `idea.selectedIncomingIndex` still needs to be set during j/k navigation
   - This is what allows nested sub-idea selection to work

2. **Phase objects are reactive:**
   - Setting `phase.selectedAimIndex` works because phases are in Pinia store
   - Make sure to use the phase object from `dataStore.phases[phaseId]`

3. **Root vs Phase branching:**
   - Always check `selectedColumn === -1` first
   - Root ideas have phaseId `'null'` but this is just for compatibility with existing methods

4. **Component prop drilling:**
   - Selection context needs to flow down the component tree
   - Top-level knows selected index, passes boolean to children
   - OR: Components compute selection by reaching up to store (current approach)

## Git Commit Strategy

After completing the refactor:
```
git add -p  # Stage changes incrementally
git commit -m "refactor: migrate to path-based selection model

- Replace selectedAim object with index-based selection
- Add Phase.selectedAimIndex for phase idea selection
- Add rootAimsSelectedIndex for root ideas selection
- Rename 'phase-edit' mode to 'ideas-edit'
- Update all navigation/creation/deletion logic
- Update components to compute selection from indices

Selection now flows down the tree via indices rather than
tracking a global ideaId, simplifying nested idea handling."
```

## Progress Summary

**85% Complete** - Core navigation and editing logic refactored.

**What's Working:**
- ✅ Ideas-edit mode navigation (j/k)
- ✅ Idea creation (o/O)
- ✅ Idea deletion
- ✅ Expand/collapse (h/l)
- ✅ Selection persistence via indices
- ✅ Mode switching

**What Needs Finishing:**
1. Remove 7 remaining `selectedAim` references in ui.ts
2. Update component selection rendering (Idea.vue, IdeasList.vue)
3. Test all scenarios thoroughly

## Next Steps for LLM

### Step 1: Clean up remaining selectedAim references

**In ui.ts:**
1. Line 1055-1073: `selectPhase` method - remove setSelectedAim call, use indices
2. Line 1207-1216: `clearPendingDelete` - use getCurrentAimContext instead
3. Line 1008-1012: Delete `setSelectedAim` method entirely
4. Update comments mentioning selectedAim

### Step 2: Update Components

**Idea.vue (line 38-40):**
Change from:
```typescript
const isThisAimSelected = computed(() => {
  return uiStore.selectedAim?.ideaId === props.idea.id
})
```

To - pass selection as prop from parent, OR compute from context:
```typescript
const isThisAimSelected = computed(() => {
  const context = uiStore.getCurrentAimContext(dataStore)
  return context?.idea.id === props.idea.id
})
```

**IdeasList.vue:** Pass computed selection down to Idea components.

### Step 3: Test Thoroughly
Use the testing checklist in this document.

Good luck! 🚀
