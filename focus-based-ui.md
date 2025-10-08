# Focus-Based UI Architecture

Aimparency uses a **focus-based navigation architecture** where browser focus management drives all UI interactions. This document describes the architectural principles and patterns.

---

## Core Principles

### 1. Focus = Selection
The browser's native focus system IS the selection state. No separate state tracking for "which element is selected."

- **Focused element** = currently selected element
- **CSS `:focus`** provides visual feedback
- **Click** automatically focuses tabindex elements (browser default)
- **Arrow keys** programmatically move focus between elements

### 2. Parent Responsibility
Parents manage navigation between their children. Children only handle their own actions.

**Parent responsibilities:**
- Track which child is focused (`focusedChildIndex` local state)
- Handle j/k navigation between children
- Handle child creation (o/O keys)
- Handle child deletion (d key)
- Expose `focusByParent()` method for programmatic focus

**Child responsibilities:**
- Handle self-editing (e key)
- Emit `@focused` when receiving focus from click
- Expose `focusByParent()` and `blurByParent()` methods

### 3. Two Focus Paths
Components distinguish between programmatic focus (from parent) and user-initiated focus (from click).

**Path 1: Parent calls `child.focusByParent()`**
```typescript
const focusByParent = () => {
  if (document.activeElement === elementRef.value) return // Already focused

  ignoreNextFocus.value = true
  elementRef.value?.focus() // Triggers browser @focus event

  // Delegate to selected child if in child-navigation mode
  if (inChildMode.value && selectedChildIndex.value !== null) {
    childRefs.value[selectedChildIndex.value]?.focusByParent()
  }
}
```

**Path 2: User clicks → browser focuses → `@focus` event**
```typescript
const handleFocus = () => {
  if (ignoreNextFocus.value) {
    ignoreNextFocus.value = false
    return // Programmatic focus, don't emit
  }

  emit('focused') // User-initiated focus, notify parent
}
```

### 4. Event Emission, Not DOM Queries
Components communicate through events and method calls, never DOM traversal.

**Navigation events (emitted upward):**
- `@focused` - Element received focus from click
- `@page-navigation(delta: number)` - Request horizontal page scroll

**Methods (called downward):**
- `focusByParent()` - Parent focusing this element
- `blurByParent()` - Parent blurring this element

**Anti-pattern (forbidden):**
```typescript
// ❌ Never do this
const nextElement = element.parentElement?.nextSibling
nextElement.focus()
```

### 5. Keyboard Event Bubbling
Components handle relevant keys and let others bubble up.

```vue
<template>
  <div
    tabindex="0"
    @keydown.e.prevent="handleEdit"
    @keydown.i.prevent="enterChildMode"
    @keydown.esc="handleEscape"
    @keydown="handleOtherKeys"
  >
</template>

<script>
const handleEscape = (e: KeyboardEvent) => {
  if (inChildMode.value) {
    e.preventDefault() // Handle: exit child mode
    exitChildMode()
  }
  // Let bubble up if not in child mode
}

const handleOtherKeys = (e: KeyboardEvent) => {
  if (e.key === 'j' || e.key === 'k') {
    // Parent handles j/k navigation
    // Don't prevent, let bubble
  }
}
</script>
```

---

## Component Hierarchy

### App.vue
**Responsibilities:**
- Manage viewport scrolling (pageFrom/pageTo)
- Pass page visibility to columns
- Handle `@page-navigation` from columns
- Display aggregated keyboard hints
- Manage keyboard hints stack

**Props passed down:**
- `pageFrom: number` - Leftmost visible page
- `pageTo: number` - Rightmost visible page

**Events listened:**
- `@page-navigation(delta)` from RootAimsColumn and first PhaseColumn

### RootAimsColumn (Page 0)
**Responsibilities:**
- Manage list of root aims (uncommitted aims)
- Handle j/k to navigate between aims
- Handle o/O to create new aims
- Handle d to delete aims
- Handle h/l to emit `@page-navigation`
- Own and manage aim creation modal

**Local state:**
- `focusedAimIndex: number` - Which aim is currently focused
- `showCreateModal: boolean` - Modal visibility
- `keyboardHints: Ref<Record<string, string>>` - Reactive hints

**Props:**
- `pageFrom: number`
- `pageTo: number`

**Methods:**
- `focusByParent()` - Focus the focused aim (or first aim)
- `blurByParent()` - Blur all aims

**Keyboard hints (when not creating):**
```typescript
{
  'j': 'next aim',
  'k': 'prev aim',
  'o': 'create aim',
  'h': 'prev page',
  'l': 'next page'
}
```

### PhaseColumn (Pages 1+)
**Responsibilities:**
- Manage list of phases in this column
- Handle j/k to navigate between phases
- Handle o/O to create new phases
- Handle d to delete phases
- Handle h/l to emit `@page-navigation`
- Own and manage phase creation modal
- Track visibility based on `pageFrom/pageTo`

**Local state:**
- `focusedPhaseIndex: number` - Which phase is currently focused
- `showCreateModal: boolean` - Modal visibility
- `keyboardHints: Ref<Record<string, string>>` - Reactive hints

**Props:**
- `phases: Phase[]`
- `columnIndex: number`
- `columnDepth: number`
- `parentPhase: Phase | null`
- `pageFrom: number`
- `pageTo: number`

**Computed:**
- `isVisible: boolean` - Whether this page is in viewport

**Methods:**
- `focusByParent()` - Focus the focused phase (or first phase)
- `blurByParent()` - Blur all phases

**Events emitted:**
- `@page-navigation(delta)` - Bubbles from Phase or self

**Keyboard hints (when not creating):**
```typescript
{
  'j': 'next phase',
  'k': 'prev phase',
  'o': 'create phase',
  'h': 'prev page',
  'l': 'next page'
}
```

**Empty state:**
When `phases.length === 0`, the column itself is focusable and handles 'o' to create first phase.

### Phase
**Responsibilities:**
- Display phase info (name, dates, progress bar)
- Manage list of committed aims
- Handle i to enter aim-edit mode
- Handle e to open edit modal (self)
- Handle Esc to exit aim-edit mode
- When in aim-edit mode: handle j/k to navigate aims, o/O to create aims, d to delete aims
- Teleport child PhaseColumn when focused
- Own and manage phase edit modal

**Local state:**
- `inAimEditMode: boolean` - Whether navigating aims vs being a selectable phase
- `focusedAimIndex: number` - Which aim is focused (when in edit mode)
- `showEditModal: boolean` - Modal visibility
- `keyboardHints: Ref<Record<string, string>>` - Reactive hints

**Props:**
- `phase: Phase`
- `columnIndex: number`
- `columnDepth: number`
- `pageFrom: number` (passed through)
- `pageTo: number` (passed through)

**Methods:**
- `focusByParent()` - Focus self, or focused aim if in edit mode
- `blurByParent()` - Blur self and all children

**Events emitted:**
- `@focused` - Phase was clicked/focused by user
- `@page-navigation(delta)` - Bubbles h/l from child or Esc from aim

**Teleport behavior:**
When this phase is focused (has browser focus OR descendant has focus), teleport child column.

```vue
<Teleport to=".main" v-if="hasFocus">
  <PhaseColumn
    :phases="childPhases"
    :column-index="columnIndex + 1"
    :page-from="pageFrom"
    :page-to="pageTo"
  />
</Teleport>
```

**Keyboard hints (normal mode):**
```typescript
{
  'i': 'enter phase aims',
  'e': 'edit phase'
}
```

**Keyboard hints (aim-edit mode):**
```typescript
{
  'j': 'next aim',
  'k': 'prev aim',
  'o': 'create aim',
  'd': 'delete aim',
  'Esc': 'leave phase aims'
}
```

### Aim
**Responsibilities:**
- Display aim info (text, status, comment)
- Handle e to open edit modal (self)
- Own and manage aim edit modal

**Local state:**
- `showEditModal: boolean` - Modal visibility
- `keyboardHints: Ref<Record<string, string>>` - Reactive hints

**Props:**
- `aim: Aim`

**Methods:**
- `focusByParent()` - Focus self
- `blurByParent()` - Blur self

**Events emitted:**
- `@focused` - Aim was clicked/focused by user

**Keyboard hints:**
```typescript
{
  'e': 'edit aim'
}
```

**Note:** j/k/d are handled by parent (Phase or RootAimsColumn).

---

## State Management

### UI Store (Pinia)
**Minimal global state:**

```typescript
state: {
  // Project
  projectPath: string
  projectHistory: Array<{ path, lastOpened, failedToLoad }>
  connectionStatus: 'connecting' | 'connected' | 'no connection'

  // Viewport scrolling
  viewportStart: number // Left edge of visible window
  viewportSize: number  // Number of pages visible (default 2)

  // Keyboard hints stack
  keyboardHintsStack: KeyboardHints[]

  // Phase reload trigger (for cache invalidation)
  phaseReloadTrigger: number
}

// Type definitions
type KeyboardHints = KeyboardHint[]
type KeyboardHint = Record<string, string>
```

**Actions:**
```typescript
// Project management
setProjectPath(path: string)
addProjectToHistory(path: string)
removeProjectFromHistory(path: string)
markProjectAsFailed(path: string)
clearProjectFailure(path: string)

// Viewport scrolling
setViewportStart(start: number)
scrollViewportLeft()
scrollViewportRight()

// Keyboard hints stack
registerKeyboardHints(hints: Ref<Record<string, string>>): () => void
// Returns unregister function

// Phase reload
triggerPhaseReload()
```

**Computed:**
```typescript
// Aggregate keyboard hints from stack
activeKeyboardHints: Hint[]
// Stack is bottom-to-top, higher entries override lower
// Convert to { key, action }[] for display
```

### Data Store (Pinia)
**Cached data:**

```typescript
state: {
  // Phase aims cache
  phaseAims: Record<phaseId, Aim[]>
}

actions: {
  async loadPhaseAims(projectPath: string, phaseId: string)
  getPhaseAims(phaseId: string): Aim[] | null

  async createAim(projectPath: string, aim: Partial<Aim>)
  async commitAimToPhase(projectPath: string, aimId: string, phaseId: string, index: number)
}
```

**Note:** Phases are NOT stored globally. Each Phase/PhaseColumn component manages its own phase data via local refs.

---

## Focus Flow Examples

### Example 1: Clicking an Aim
1. User clicks aim element
2. Browser focuses aim (tabindex="0")
3. Aim's `@focus` handler fires
4. `handleFocus()` checks `ignoreNextFocus` (false)
5. Aim emits `@focused`
6. Parent (Phase) receives `@focused` event
7. Parent updates `focusedAimIndex` to this aim's index
8. CSS `:focus` provides visual feedback

### Example 2: Pressing 'j' on a Phase
1. Phase has browser focus
2. User presses 'j'
3. Phase doesn't handle 'j', lets bubble
4. Parent (PhaseColumn) receives `@keydown`
5. PhaseColumn handles 'j': `e.preventDefault()`
6. PhaseColumn increments `focusedPhaseIndex`
7. PhaseColumn calls `phaseRefs[focusedPhaseIndex].focusByParent()`
8. Phase's `focusByParent()` sets `ignoreNextFocus = true`
9. Phase calls `phaseRef.value.focus()`
10. Browser focus event fires, but `ignoreNextFocus` prevents `@focused` emit

### Example 3: Pressing 'i' on a Phase
1. Phase has browser focus
2. User presses 'i'
3. Phase handles `@keydown.i.prevent`
4. Phase sets `inAimEditMode = true`
5. Phase updates `keyboardHints` reactive object
6. Phase calls `aimRefs[0].focusByParent()` (focus first aim)
7. First aim receives focus
8. Footer keyboard hints update automatically (stack changed)

### Example 4: Pressing 'l' on a Phase
1. Phase has browser focus
2. User presses 'l'
3. Phase doesn't handle 'l', lets bubble
4. Parent (PhaseColumn) receives `@keydown`
5. PhaseColumn handles 'l': `e.preventDefault()`
6. PhaseColumn emits `@page-navigation(+1)`
7. Event bubbles to App.vue
8. App increments `viewportStart`
9. App updates `pageFrom/pageTo` props
10. CSS transform slides viewport
11. PhaseColumn calls `childColumnRef.value?.focusByParent()`
12. Child column focuses its first/focused phase

### Example 5: Opening Phase Edit Modal
1. Phase has browser focus
2. User presses 'e'
3. Phase handles `@keydown.e.prevent`
4. Phase sets `showEditModal = true`
5. Modal renders with input focused
6. User edits name/dates
7. User presses Enter or clicks Save
8. Phase calls tRPC mutation
9. Phase sets `showEditModal = false`
10. Phase's watcher sees modal close
11. Phase calls `phaseRef.value?.focus()` to restore focus

---

## Viewport Scrolling

### Page Navigation
- Each column is a "page" (50% width)
- Viewport shows 2 pages at a time
- Transform: `translateX(-viewportStart * 50%)`

### Edge-Triggered Scrolling
When `@page-navigation(delta)` received:

```typescript
const handlePageNavigation = (delta: number) => {
  const targetPage = currentFocusedPage + delta

  // Boundary check
  if (targetPage < 0 || targetPage > rightmostPage) return

  // Edge-triggered left
  if (targetPage === viewportStart && viewportStart > 0) {
    viewportStart--
  }

  // Edge-triggered right
  const viewportEnd = viewportStart + viewportSize - 1
  if (targetPage === viewportEnd) {
    const maxViewportStart = rightmostPage - viewportSize + 1
    if (viewportStart < maxViewportStart) {
      viewportStart++
    }
  }

  // Focus target page
  const targetColumn = getColumnByIndex(targetPage)
  targetColumn?.focusByParent()
}
```

### Page Visibility
Each PhaseColumn computes:

```typescript
const isVisible = computed(() =>
  columnIndex >= pageFrom && columnIndex <= pageTo
)
```

When not visible, column disables pointer events and reduces opacity (but still renders for smooth transitions).

---

## Keyboard Hints System

### Stack-Based Override
Components register their hints with the store on mount:

```typescript
// In Phase.vue
const keyboardHints = ref<Record<string, string>>({
  'i': 'enter phase aims',
  'e': 'edit phase'
})

const unregister = uiStore.registerKeyboardHints(keyboardHints)

onUnmounted(() => unregister())

// When entering aim-edit mode:
watch(inAimEditMode, (editing) => {
  if (editing) {
    keyboardHints.value = {
      'j': 'next aim',
      'k': 'prev aim',
      'o': 'create aim',
      'd': 'delete aim',
      'Esc': 'leave phase aims'
    }
  } else {
    keyboardHints.value = {
      'i': 'enter phase aims',
      'e': 'edit phase'
    }
  }
})
```

### Store Aggregation
```typescript
// In UI store
const activeKeyboardHints = computed(() => {
  const merged: Record<string, string> = {}

  // Bottom to top - higher entries override
  for (const hints of keyboardHintsStack) {
    for (const hint of hints) {
      Object.assign(merged, hint)
    }
  }

  // Convert to Hint[] for display
  return Object.entries(merged).map(([key, action]) => ({
    key,
    action
  }))
})
```

### Display
```vue
<!-- App.vue footer -->
<footer class="help">
  <div class="help-keys">
    <div v-for="hint in uiStore.activeKeyboardHints" :key="hint.key" class="hint">
      <span class="key">{{ hint.key }}</span>
      <span class="action">{{ hint.action }}</span>
    </div>
  </div>
</footer>
```

---

## CSS Patterns

### Focus Styling
Global focus styles in `style.css`:

```css
.focusable {
  border: 1px solid #444;
  border-radius: 0.3rem;
}

.focusable:focus {
  background-color: #3594;
  outline: 0.1rem solid #007acc44;
  outline-offset: -2px;
}
```

### Page Visibility
```css
.phase-column {
  opacity: 1;
  pointer-events: auto;
  transition: opacity 0.3s;
}

.phase-column.not-visible {
  opacity: 0.3;
  pointer-events: none;
}
```

---

## Benefits of This Architecture

1. **No State Sync Issues**: Browser focus IS the state, can't desync
2. **Natural Click Behavior**: Tabindex elements auto-focus on click
3. **Clear Responsibilities**: Parents navigate children, children edit themselves
4. **Composable**: Easy to add new navigable components
5. **Accessible**: Built on native focus management
6. **Debuggable**: `document.activeElement` shows current state
7. **Minimal Global State**: Only viewport and hints stack
8. **Modal-Free Store**: Components own their modals, no global modal state

---

## Anti-Patterns to Avoid

❌ **Storing selection indices in global store**
```typescript
// Don't do this
selectedPhaseByColumn: Record<number, number>
```

✅ **Track focus in component local state**
```typescript
// Do this
const focusedPhaseIndex = ref(0)
```

---

❌ **DOM queries for navigation**
```typescript
// Don't do this
const next = element.nextElementSibling
next.focus()
```

✅ **Use refs and method calls**
```typescript
// Do this
phaseRefs.value[focusedPhaseIndex + 1]?.focusByParent()
```

---

❌ **Global keyboard handler**
```typescript
// Don't do this
const handleGlobalKeydown = (e: KeyboardEvent) => {
  if (mode === 'phase-edit') {
    // handle keys...
  }
}
```

✅ **Component-local handlers with bubbling**
```typescript
// Do this
<div @keydown.j="handleDown" @keydown.k="handleUp">
```

---

❌ **Synchronizing focus state**
```typescript
// Don't do this
watch(() => selectedIndex, (index) => {
  elementRefs[index]?.focus()
})
```

✅ **Direct method calls**
```typescript
// Do this
const navigateDown = () => {
  focusedIndex++
  childRefs.value[focusedIndex]?.focusByParent()
}
```
