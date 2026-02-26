# Aim Defaults Refactoring

## Problem
Default values for new aims were scattered across multiple locations:
- **AimCreationModal.vue** line 16: ref declarations
- **AimCreationModal.vue** line 331: onMounted reset logic
- **ui.ts** line 361: createAim function parameters

This duplication led to bugs when we fixed one location but not the others (e.g., loop weight default).

## Solution
Created a single source of truth for aim defaults in `constants/aimDefaults.ts`.

### New Constants File
```typescript
// packages/frontend/src/constants/aimDefaults.ts
export const AIM_DEFAULTS = {
  text: '',
  description: '',
  tags: [] as string[],
  intrinsicValue: 0,
  cost: 1,
  loopWeight: 1,
  status: {
    state: 'open' as AimStatusState,
    comment: ''
  }
} as const
```

### Usage

#### AimCreationModal.vue
- **Ref declarations** (line 12-19): Use `AIM_DEFAULTS.*`
- **Reset logic** (line 327-334): Use `AIM_DEFAULTS.*`

#### ui.ts
- **Function signature** (line 362): Use `AIM_DEFAULTS.*` for default parameter values

## Benefits
1. **Single source of truth**: All defaults defined in one place
2. **Type safety**: TypeScript ensures consistency
3. **Maintainability**: Changing a default only requires updating one file
4. **No more bugs**: Impossible to have mismatched defaults between locations

## Files Modified
- Created: `packages/frontend/src/constants/aimDefaults.ts`
- Modified: `packages/frontend/src/components/AimCreationModal.vue`
- Modified: `packages/frontend/src/stores/ui.ts`

## Backend Defaults
Backend still has its own defaults (in `server.ts`):
- `loopWeight ?? 1` (lines 996, 1084, 1161)
- First aim gets `intrinsicValue: 1000`

Frontend defaults align with backend defaults, except:
- Frontend: `intrinsicValue = 0` (allows backend to apply first-aim logic)
- Backend: First aim gets 1000, subsequent aims get 0

This is intentional - frontend passes 0, backend decides if this is the first aim.
