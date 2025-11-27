# Preventing Infinite Recursion in Circular Aim Structures

## Problem

When linking aims that create cycles (A → B → A), infinite recursion occurs if both aims are expanded.

## Solution: Track Ancestor IDs in Component Tree

**Keep `expanded` on aim objects** (no change to stores).

**Add cycle detection in components:**
- Pass a Set of ancestor aim IDs down the component tree
- Each Aim component adds its own ID to the set before passing to children
- If an aim's ID is already in the ancestor set, don't expand it (cycle detected)

## Implementation

### 1. Update Aim.vue

**Add prop:**
```typescript
ancestorAimIds: Set<string>  // IDs of all aims above this one in the tree
```

**Modify computed `isExpanded`:**
```typescript
const isExpanded = computed(() => {
  // Don't expand if this aim is already an ancestor (cycle prevention)
  if (props.ancestorAimIds.has(props.aim.id)) {
    return false
  }
  return props.aim.expanded ?? false
})
```

**When rendering AimsList for incoming aims:**
```typescript
// Create new set with this aim's ID added
const childAncestors = new Set(props.ancestorAimIds)
childAncestors.add(props.aim.id)

// Pass to AimsList
<AimsList :ancestorAimIds="childAncestors" ... />
```

### 2. Update AimsList.vue

**Add prop:**
```typescript
ancestorAimIds: Set<string>
```

**Pass to each Aim:**
```typescript
<Aim :ancestorAimIds="ancestorAimIds" ... />
```

### 3. Update Root Components

**RootAimsColumn.vue / PhaseColumn.vue:**

Initialize with empty set:
```typescript
<AimsList :ancestorAimIds="new Set()" ... />
```

## Why This Works

- Cycle detected at component level before rendering
- No changes to stores or data structures
- Prevents infinite component tree depth
- Aims can still have `expanded=true`, just won't render if they're an ancestor

## Additional: Prevent Cycles in Aim Movement (J/K Navigation)

When navigating up/down through aims with J/K keys, cycles could cause infinite loops traversing the aim tree.

### Solution for moveAimDown/moveAimUp (ui.ts)

**Add cycle detection when traversing aim paths:**

```typescript
// In getSelectionPath() or move functions
const visitedAimIds = new Set<string>()

// When traversing through aims:
if (visitedAimIds.has(aimId)) {
  // Cycle detected, stop traversal
  return
}
visitedAimIds.add(aimId)
```

**Apply to:**
- `getSelectionPath()` - When building the path through parent aims
- `moveAimDown()` - When finding next aim in tree
- `moveAimUp()` - When finding previous aim in tree

## Files to Modify

1. `/packages/frontend/src/components/Aim.vue` - Add prop, update isExpanded, pass enriched set to children
2. `/packages/frontend/src/components/AimsList.vue` - Add prop, pass to Aim components
3. `/packages/frontend/src/components/RootAimsColumn.vue` - Initialize with empty Set
4. `/packages/frontend/src/components/PhaseColumn.vue` - Initialize with empty Set
5. `/packages/frontend/src/stores/ui.ts` - Add cycle detection to getSelectionPath, moveAimDown, moveAimUp
