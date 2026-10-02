# Selection Refactoring - Path-Based Selection Model

## Context
The current selection system uses a global `selectedIdea` object with `ideaId` to track which idea is selected. This creates complexity when navigating nested sub-ideas and handling deletion. We're refactoring to a **path-based selection model** where selection flows down the tree via indices.

## Goal
Remove redundant `ideaId` tracking and use implicit path-based selection that follows the data structure:
- Column → Phase → Top-level idea → Sub-idea (via indices)

## Current vs New Model

### Old (Current):
```typescript
// UI Store
selectedIdea: { phaseId: string, ideaIndex: number, ideaId?: string } | null
lastSelectedRootIdeaIndex: number
lastSelectedIdeaIndexByPhase: Record<string, number>

// Selection determined by:
uiStore.selectedIdea?.ideaId === idea.id
```

### New (Target):
```typescript
// UI Store
mode: 'column-navigation' | 'ideas-edit' | 'idea-edit'
rootIdeasSelectedIndex: number  // For column -1

// Data Store - Phase type (UI-only properties)
phase.selectedIdeaIndex?: number

// Data Store - Idea type (already exists)
idea.selectedIncomingIndex?: number

// Selection path reconstruction:
// 1. Root ideas: rootIdeasSelectedIndex → ideas[index].selectedIncomingIndex → recurse
// 2. Phase ideas: selectedPhaseByColumn[col] → phase.selectedIdeaIndex → ideas[index].selectedIncomingIndex → recurse

// Selection determined by checking if index matches parent's selection
```

## Completed Work ✅ (Updated)

### 1. Type Definitions (data.ts)
- ✅ Extended Phase type with `selectedIdeaIndex?: number`
- ✅ Extended Idea type already had `selectedIncomingIndex?: number`

### 2. UI Store State (ui.ts)
- ✅ Changed mode type: `'phase-edit'` → `'ideas-edit'`
- ✅ Added `rootIdeasSelectedIndex: number`
- ⚠️ Removed `lastSelectedRootIdeaIndex` and `lastSelectedIdeaIndexByPhase`
- ⚠️ `selectedIdea` object still exists but mostly unused (7 remaining references)

### 3. Mode String Updates
- ✅ Updated all `'phase-edit'` → `'ideas-edit'` in:
  - ui.ts: mode checks, setMode calls, handlePhaseEditKeys → handleIdeasEditKeys
  - App.vue: keyboard hints watch
  - data.ts: comment in deletion logic

### 4. Helper Methods (ui.ts)
- ✅ Added `getCurrentIdeaContext(dataStore)` - returns phaseId, idea, ideaIndex
- ✅ Added `setCurrentIdeaIndex(ideaIndex, dataStore)` - sets appropriate index

### 5. handleIdeasEditKeys Method (ui.ts)
- ✅ Refactored to use `context = getCurrentIdeaContext(dataStore)`
- ✅ Escape key: No longer calls setSelectedIdea, indices stay in place
- ✅ o/O keys: Uses context.idea, context.ideaIndex
- ✅ j/k navigation: Uses setCurrentIdeaIndex, updates selectedIncomingIndex
- ✅ e/d/h/l keys: All use context.idea

### 6. handleColumnNavigationKeys Method (ui.ts)
- ✅ 'i' key: Sets index via setCurrentIdeaIndex, uses phase.selectedIdeaIndex
- ✅ 'j'/'k' keys in root column: Updates rootIdeasSelectedIndex

### 7. Deletion Logic (data.ts)
- ✅ Gets deletedIndex from rootIdeasSelectedIndex or phase.selectedIdeaIndex
- ✅ Sets new index after deletion to appropriate location
- ✅ Sub-idea deletion: Updates parent's selectedIncomingIndex

## Remaining Work 🚧 (Updated)

### Remaining selectedIdea References (~7 in ui.ts)

**Locations:**
1. Line 1008-1012: `setSelectedIdea` method definition - CAN BE REMOVED
2. Line 1055: `selectPhase` cascade restoration logic
3. Line 1073: `selectPhase` calls setSelectedIdea
4. Line 1160, 1187: Comments about clearing selectedIdea
5. Line 1207-1216: `clearPendingDelete` method saves selection

**Strategy:**
- Remove `setSelectedIdea` method entirely
- Update `selectPhase` to not use selectedIdea
- Update `clearPendingDelete` to use indices instead

### Critical: Component Selection Rendering

#### Pattern 1: Getting current idea in navigation/operations
**Old:**
```typescript
const currentIdeaId = selectedIdea.ideaId || ideas[selectedIdea.ideaIndex]?.id
```

**New (Root ideas):**
```typescript
if (selectedColumn === -1) {
  const ideas = dataStore.getIdeasForPhase('null')
  const currentIdea = ideas[rootIdeasSelectedIndex]
}
```

**New (Phase ideas):**
```typescript
if (selectedColumn >= 0) {
  const phaseId = getSelectedPhaseId(selectedColumn)
  const phase = dataStore.phases[phaseId]
  const ideas = dataStore.getIdeasForPhase(phaseId)
  const currentIdea = ideas[phase.selectedIdeaIndex!]
}
```

#### Pattern 2: Mode checking
**Old:**
```typescript
if (selectedIdea?.phaseId === phaseId) { ... }
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
setSelectedIdea(phaseId, ideaIndex, idea?.id)
lastSelectedIdeaIndexByPhase[phaseId] = ideaIndex
```

**New (Root ideas):**
```typescript
setMode('ideas-edit')
rootIdeasSelectedIndex = ideaIndex
```

**New (Phase ideas):**
```typescript
setMode('ideas-edit')
const phase = dataStore.phases[phaseId]
phase.selectedIdeaIndex = ideaIndex
```

#### Pattern 4: Exiting ideas-edit mode
**Old:**
```typescript
setMode('column-navigation')
setSelectedIdea(null, null)
```

**New:**
```typescript
setMode('column-navigation')
// Indices stay in place (rootIdeasSelectedIndex, phase.selectedIdeaIndex)
```

### Specific Files to Update

#### ui.ts - Key Methods

**handleIdeasEditKeys (line 667):**
- Replace `const selectedIdea = this.selectedIdea` with helper to get current context
- Update all `selectedIdea.phaseId`, `selectedIdea.ideaIndex` references
- Update navigation (j/k) to update correct index:
  - Root: `this.rootIdeasSelectedIndex`
  - Phase: `phase.selectedIdeaIndex`

**handleColumnNavigationKeys - 'i' key (line 504):**
- Update idea selection logic to set appropriate index instead of selectedIdea

**o/O key handling (line 698):**
- Get current idea via index instead of selectedIdea
- Update insertion index tracking

**Navigation helpers (findNextIdeaInTree, etc.):**
- These might still work as-is since they take ideaId and phaseId as parameters
- Call sites need updating to pass correct parameters

**setSelectedIdea method (line 1008):**
- **Remove this method entirely** - replaced by setting indices directly
- Or refactor to `setIdeaSelection(columnIndex: number, ideaIndex: number)`

#### data.ts - Deletion Logic

**deleteIdea method (line 319):**
- Line 324-326: Replace `deletedIndex` from `selectedIdea.ideaIndex`
  ```typescript
  // Old
  const deletedIndex = uiStore.selectedIdea?.phaseId === phaseId && uiStore.selectedIdea?.ideaIndex !== undefined
    ? uiStore.selectedIdea.ideaIndex : -1

  // New (Root)
  const deletedIndex = phaseId === 'null' ? uiStore.rootIdeasSelectedIndex : -1

  // New (Phase)
  const phase = this.phases[phaseId]
  const deletedIndex = phase?.selectedIdeaIndex ?? -1
  ```

- Line 404-416: Update selection adjustment logic to set appropriate index
  ```typescript
  // Root ideas
  if (phaseId === 'null') {
    uiStore.rootIdeasSelectedIndex = newIndex
  } else {
    // Phase ideas
    const phase = this.phases[phaseId]
    if (phase) {
      phase.selectedIdeaIndex = newIndex
    }
  }
  ```

#### Components - Selection Rendering

**Idea.vue (line 38-40):**
```typescript
// Old
const isThisIdeaSelected = computed(() => {
  return uiStore.selectedIdea?.ideaId === props.idea.id
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
'selected-outlined': isActive && uiStore.selectedIdea?.ideaId === idea.id

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
    if (index === uiStore.rootIdeasSelectedIndex) {
      return !parentIdea // Top-level
    }
    // Check if we're a selected sub-idea
    if (parentIdea && parentIdea.selectedIncomingIndex === indexInParent) {
      return true
    }
  } else {
    // Phase ideas: similar logic with phase.selectedIdeaIndex
    const phaseId = uiStore.getSelectedPhaseId(uiStore.selectedColumn)
    const phase = dataStore.phases[phaseId]
    if (index === phase?.selectedIdeaIndex) {
      return !parentIdea
    }
    if (parentIdea && parentIdea.selectedIncomingIndex === indexInParent) {
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

**ui.ts - getCurrentIdeaContext():**
```typescript
getCurrentIdeaContext(): { phaseId: string, idea: Idea, ideaIndex: number } | null {
  if (this.mode !== 'ideas-edit') return null

  if (this.selectedColumn === -1) {
    // Root ideas
    const ideas = dataStore.getIdeasForPhase('null')
    const idea = ideas[this.rootIdeasSelectedIndex]
    return idea ? { phaseId: 'null', idea, ideaIndex: this.rootIdeasSelectedIndex } : null
  } else {
    // Phase ideas
    const phaseId = this.getSelectedPhaseId(this.selectedColumn)
    if (!phaseId) return null
    const phase = dataStore.phases[phaseId]
    const ideas = dataStore.getIdeasForPhase(phaseId)
    const ideaIndex = phase?.selectedIdeaIndex ?? 0
    const idea = ideas[ideaIndex]
    return idea ? { phaseId, idea, ideaIndex } : null
  }
}
```

**ui.ts - setCurrentIdeaIndex(index: number):**
```typescript
setCurrentIdeaIndex(index: number) {
  if (this.selectedColumn === -1) {
    this.rootIdeasSelectedIndex = index
  } else {
    const phaseId = this.getSelectedPhaseId(this.selectedColumn)
    if (phaseId) {
      const phase = dataStore.phases[phaseId]
      if (phase) {
        phase.selectedIdeaIndex = index
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
- [ ] No console errors about undefined selectedIdea
- [ ] Visual selection highlighting works correctly

## Key Principles

1. **Separation of concerns:**
   - Root ideas: Use `rootIdeasSelectedIndex` in UI store
   - Phase ideas: Use `phase.selectedIdeaIndex` in data store
   - Sub-ideas: Use `idea.selectedIncomingIndex` (already working)

2. **Minimal code duplication:**
   - Check `selectedColumn === -1` to branch root vs phase logic
   - Use helper methods like `getCurrentIdeaContext()` for common patterns

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
   - Setting `phase.selectedIdeaIndex` works because phases are in Pinia store
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

- Replace selectedIdea object with index-based selection
- Add Phase.selectedIdeaIndex for phase idea selection
- Add rootIdeasSelectedIndex for root ideas selection
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
1. Remove 7 remaining `selectedIdea` references in ui.ts
2. Update component selection rendering (Idea.vue, IdeasList.vue)
3. Test all scenarios thoroughly

## Next Steps for LLM

### Step 1: Clean up remaining selectedIdea references

**In ui.ts:**
1. Line 1055-1073: `selectPhase` method - remove setSelectedIdea call, use indices
2. Line 1207-1216: `clearPendingDelete` - use getCurrentIdeaContext instead
3. Line 1008-1012: Delete `setSelectedIdea` method entirely
4. Update comments mentioning selectedIdea

### Step 2: Update Components

**Idea.vue (line 38-40):**
Change from:
```typescript
const isThisIdeaSelected = computed(() => {
  return uiStore.selectedIdea?.ideaId === props.idea.id
})
```

To - pass selection as prop from parent, OR compute from context:
```typescript
const isThisIdeaSelected = computed(() => {
  const context = uiStore.getCurrentIdeaContext(dataStore)
  return context?.idea.id === props.idea.id
})
```

**IdeasList.vue:** Pass computed selection down to Idea components.

### Step 3: Test Thoroughly
Use the testing checklist in this document.

Good luck! 🚀
