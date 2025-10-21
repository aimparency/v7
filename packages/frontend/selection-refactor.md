# Selection Refactoring - Path-Based Selection Model

## Context
The current selection system uses a global `selectedAim` object with `aimId` to track which aim is selected. This creates complexity when navigating nested sub-aims and handling deletion. We're refactoring to a **path-based selection model** where selection flows down the tree via indices.

## Goal
Remove redundant `aimId` tracking and use implicit path-based selection that follows the data structure:
- Column → Phase → Top-level aim → Sub-aim (via indices)

## Current vs New Model

### Old (Current):
```typescript
// UI Store
selectedAim: { phaseId: string, aimIndex: number, aimId?: string } | null
lastSelectedRootAimIndex: number
lastSelectedAimIndexByPhase: Record<string, number>

// Selection determined by:
uiStore.selectedAim?.aimId === aim.id
```

### New (Target):
```typescript
// UI Store
mode: 'column-navigation' | 'aims-edit' | 'aim-edit'
rootAimsSelectedIndex: number  // For column -1

// Data Store - Phase type (UI-only properties)
phase.selectedAimIndex?: number

// Data Store - Aim type (already exists)
aim.selectedIncomingIndex?: number

// Selection path reconstruction:
// 1. Root aims: rootAimsSelectedIndex → aims[index].selectedIncomingIndex → recurse
// 2. Phase aims: selectedPhaseByColumn[col] → phase.selectedAimIndex → aims[index].selectedIncomingIndex → recurse

// Selection determined by checking if index matches parent's selection
```

## Completed Work ✅

### 1. Type Definitions (data.ts)
- Extended Phase type with `selectedAimIndex?: number`
- Extended Aim type already had `selectedIncomingIndex?: number`

### 2. UI Store State (ui.ts)
- Changed mode type: `'phase-edit'` → `'aims-edit'`
- Added `rootAimsSelectedIndex: number`
- Removed `selectedAim` object (NOTE: Not fully removed yet, still referenced)
- Removed `lastSelectedRootAimIndex` and `lastSelectedAimIndexByPhase`

### 3. Mode String Updates
- Updated all `'phase-edit'` → `'aims-edit'` in:
  - ui.ts: mode checks, setMode calls, handlePhaseEditKeys → handleAimsEditKeys
  - App.vue: keyboard hints watch
  - data.ts: comment in deletion logic

## Remaining Work 🚧

### Critical: Remove selectedAim References
`selectedAim` is still referenced in ~50+ places. Need systematic replacement:

#### Pattern 1: Getting current aim in navigation/operations
**Old:**
```typescript
const currentAimId = selectedAim.aimId || aims[selectedAim.aimIndex]?.id
```

**New (Root aims):**
```typescript
if (selectedColumn === -1) {
  const aims = dataStore.getAimsForPhase('null')
  const currentAim = aims[rootAimsSelectedIndex]
}
```

**New (Phase aims):**
```typescript
if (selectedColumn >= 0) {
  const phaseId = getSelectedPhaseId(selectedColumn)
  const phase = dataStore.phases[phaseId]
  const aims = dataStore.getAimsForPhase(phaseId)
  const currentAim = aims[phase.selectedAimIndex!]
}
```

#### Pattern 2: Mode checking
**Old:**
```typescript
if (selectedAim?.phaseId === phaseId) { ... }
```

**New:**
```typescript
if (mode === 'aims-edit') {
  if (selectedColumn === -1) {
    // Root aims editing
  } else {
    // Phase aims editing
    const phaseId = getSelectedPhaseId(selectedColumn)
  }
}
```

#### Pattern 3: Entering aims-edit mode
**Old:**
```typescript
setMode('aims-edit')
setSelectedAim(phaseId, aimIndex, aim?.id)
lastSelectedAimIndexByPhase[phaseId] = aimIndex
```

**New (Root aims):**
```typescript
setMode('aims-edit')
rootAimsSelectedIndex = aimIndex
```

**New (Phase aims):**
```typescript
setMode('aims-edit')
const phase = dataStore.phases[phaseId]
phase.selectedAimIndex = aimIndex
```

#### Pattern 4: Exiting aims-edit mode
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
- Update all `selectedAim.phaseId`, `selectedAim.aimIndex` references
- Update navigation (j/k) to update correct index:
  - Root: `this.rootAimsSelectedIndex`
  - Phase: `phase.selectedAimIndex`

**handleColumnNavigationKeys - 'i' key (line 504):**
- Update aim selection logic to set appropriate index instead of selectedAim

**o/O key handling (line 698):**
- Get current aim via index instead of selectedAim
- Update insertion index tracking

**Navigation helpers (findNextAimInTree, etc.):**
- These might still work as-is since they take aimId and phaseId as parameters
- Call sites need updating to pass correct parameters

**setSelectedAim method (line 1008):**
- **Remove this method entirely** - replaced by setting indices directly
- Or refactor to `setAimSelection(columnIndex: number, aimIndex: number)`

#### data.ts - Deletion Logic

**deleteAim method (line 319):**
- Line 324-326: Replace `deletedIndex` from `selectedAim.aimIndex`
  ```typescript
  // Old
  const deletedIndex = uiStore.selectedAim?.phaseId === phaseId && uiStore.selectedAim?.aimIndex !== undefined
    ? uiStore.selectedAim.aimIndex : -1

  // New (Root)
  const deletedIndex = phaseId === 'null' ? uiStore.rootAimsSelectedIndex : -1

  // New (Phase)
  const phase = this.phases[phaseId]
  const deletedIndex = phase?.selectedAimIndex ?? -1
  ```

- Line 404-416: Update selection adjustment logic to set appropriate index
  ```typescript
  // Root aims
  if (phaseId === 'null') {
    uiStore.rootAimsSelectedIndex = newIndex
  } else {
    // Phase aims
    const phase = this.phases[phaseId]
    if (phase) {
      phase.selectedAimIndex = newIndex
    }
  }
  ```

#### Components - Selection Rendering

**Aim.vue (line 38-40):**
```typescript
// Old
const isThisAimSelected = computed(() => {
  return uiStore.selectedAim?.aimId === props.aim.id
})

// New - need parent context passed as prop
// Parent tells child: "you are at index X, check if parent selected you"
const props = defineProps<{
  aim: Aim
  isSelected: boolean  // Computed by parent based on indices
  // ... other props
}>()
```

**AimsList.vue (line 50-51):**
```typescript
// Old
'selected-outlined': isActive && uiStore.selectedAim?.aimId === aim.id

// New - compute selection per aim
<AimComponent
  v-for="(aim, index) in aims"
  :key="aim.id"
  :aim="aim"
  :is-selected="computeIsSelected(index, aim)"
  :class="{
    'selected-outlined': isActive && computeIsSelected(index, aim),
    // ...
  }"
/>

// Helper method
const computeIsSelected = (index: number, aim: Aim) => {
  if (uiStore.mode !== 'aims-edit') return false

  if (uiStore.selectedColumn === -1) {
    // Root aims: check if this is the selected top-level index
    if (index === uiStore.rootAimsSelectedIndex) {
      return !parentAim // Top-level
    }
    // Check if we're a selected sub-aim
    if (parentAim && parentAim.selectedIncomingIndex === indexInParent) {
      return true
    }
  } else {
    // Phase aims: similar logic with phase.selectedAimIndex
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
- Top-level AimsList receives phase/root context
- Computes which aim is selected at this level
- Passes `isSelected` prop to child Aim components
- Aim components pass selection context to nested AimsList

### Helper Methods to Add

**ui.ts - getCurrentAimContext():**
```typescript
getCurrentAimContext(): { phaseId: string, aim: Aim, aimIndex: number } | null {
  if (this.mode !== 'aims-edit') return null

  if (this.selectedColumn === -1) {
    // Root aims
    const aims = dataStore.getAimsForPhase('null')
    const aim = aims[this.rootAimsSelectedIndex]
    return aim ? { phaseId: 'null', aim, aimIndex: this.rootAimsSelectedIndex } : null
  } else {
    // Phase aims
    const phaseId = this.getSelectedPhaseId(this.selectedColumn)
    if (!phaseId) return null
    const phase = dataStore.phases[phaseId]
    const aims = dataStore.getAimsForPhase(phaseId)
    const aimIndex = phase?.selectedAimIndex ?? 0
    const aim = aims[aimIndex]
    return aim ? { phaseId, aim, aimIndex } : null
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

### Root Aims Column
- [ ] Navigate with j/k between root aims
- [ ] Press 'i' to enter aims-edit mode on root aim
- [ ] Press 'o'/'O' to create aim above/below
- [ ] Expand aim with 'l', create sub-aim with 'o'
- [ ] Navigate sub-aims with j/k
- [ ] Delete aim with 'd' twice - selection moves correctly
- [ ] Delete last sub-aim - selects parent
- [ ] Press Esc to exit back to column-navigation

### Phase Aims
- [ ] Select phase, press 'i' to enter aims-edit mode
- [ ] Navigate aims with j/k
- [ ] Create aims with o/O
- [ ] Expand and create sub-aims
- [ ] Delete aims - selection adjusts correctly
- [ ] Press Esc to return to column-navigation

### Cross-cutting
- [ ] Selection persists when switching between columns
- [ ] Selection restores when re-entering aims-edit mode
- [ ] No console errors about undefined selectedAim
- [ ] Visual selection highlighting works correctly

## Key Principles

1. **Separation of concerns:**
   - Root aims: Use `rootAimsSelectedIndex` in UI store
   - Phase aims: Use `phase.selectedAimIndex` in data store
   - Sub-aims: Use `aim.selectedIncomingIndex` (already working)

2. **Minimal code duplication:**
   - Check `selectedColumn === -1` to branch root vs phase logic
   - Use helper methods like `getCurrentAimContext()` for common patterns

3. **Selection is implicit path:**
   - No need to store `aimId` - reconstruct from indices
   - Components determine if they're selected by checking their index against parent

4. **Indices persist across mode changes:**
   - Don't clear indices when exiting aims-edit mode
   - This allows selection to restore when re-entering

## Common Pitfalls

1. **Don't forget sub-aim selection:**
   - `aim.selectedIncomingIndex` still needs to be set during j/k navigation
   - This is what allows nested sub-aim selection to work

2. **Phase objects are reactive:**
   - Setting `phase.selectedAimIndex` works because phases are in Pinia store
   - Make sure to use the phase object from `dataStore.phases[phaseId]`

3. **Root vs Phase branching:**
   - Always check `selectedColumn === -1` first
   - Root aims have phaseId `'null'` but this is just for compatibility with existing methods

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
- Add Phase.selectedAimIndex for phase aim selection
- Add rootAimsSelectedIndex for root aims selection
- Rename 'phase-edit' mode to 'aims-edit'
- Update all navigation/creation/deletion logic
- Update components to compute selection from indices

Selection now flows down the tree via indices rather than
tracking a global aimId, simplifying nested aim handling."
```

## Next Steps for LLM

1. Start with updating `handleAimsEditKeys`:
   - Add `getCurrentAimContext()` helper at top of file
   - Replace all `selectedAim` references with helper
   - Update j/k navigation to set appropriate indices

2. Update `handleColumnNavigationKeys` 'i' key:
   - Set appropriate index instead of calling `setSelectedAim`

3. Update o/O key handling:
   - Use `getCurrentAimContext()` to get current aim
   - Update all aim creation logic

4. Update deletion in data.ts:
   - Get deletedIndex from appropriate source
   - Set appropriate index after deletion

5. Finally update components:
   - Make components compute selection from indices
   - May need to pass more context as props

6. Test thoroughly using checklist above

Good luck! 🚀
