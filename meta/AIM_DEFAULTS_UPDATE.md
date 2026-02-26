# Aim Defaults Update

## Summary

Updated default values for newly created aims to improve UX and workflow:

1. **Loop Weight**: Defaults to `1` (was `0`)
2. **First Aim Intrinsic Value**: Defaults to `1000` (was `0`)

## Rationale

### Loop Weight = 1
- **Before**: New aims had `loopWeight = 0`, meaning they retained no value for themselves
- **After**: New aims have `loopWeight = 1`, meaning they retain their own value by default
- **Why**: Most aims should retain their own importance. Setting loop to 0 should be a conscious choice to delegate all value to sub-aims.

### First Aim = 1k Intrinsic Value
- **Before**: All aims defaulted to `intrinsicValue = 0`
- **After**: The very first aim in a project gets `intrinsicValue = 1000` (1k)
- **Why**: Every project needs an initial source of value. The first aim represents the core goal/vision, so it should have intrinsic value to propagate through the graph.

## Changes Made

### Backend (`packages/backend/src/server.ts`)

**1. createFloatingAim** (lines 996-1013)
```typescript
// Check if this is the first aim in the project
const normalizedPath = normalizeProjectPath(input.projectPath);
const aimsDir = path.join(normalizedPath, 'aims');
const existingAims = await fs.pathExists(aimsDir)
  ? (await fs.readdir(aimsDir)).filter(f => f.endsWith('.json')).length
  : 0;
const isFirstAim = existingAims === 0;

const aim: Aim = {
  // ...
  intrinsicValue: input.aim.intrinsicValue ?? (isFirstAim ? 1000 : 0),
  cost: input.aim.cost ?? 1,
  loopWeight: input.aim.loopWeight ?? 1  // Changed from 0 to 1
};
```

**2. createSubAim** (line 1084)
```typescript
loopWeight: input.aim.loopWeight ?? 1  // Changed from 0 to 1
```

**3. createAimInPhase** (line 1161)
```typescript
loopWeight: input.aim.loopWeight ?? 1  // Changed from 0 to 1
```

### Frontend (`packages/frontend/src/stores/ui.ts`)

**Already had correct default!**
```typescript
async createAim(
  aimTextOrId: string,
  isExistingAim: boolean = false,
  description?: string,
  tags?: string[],
  intrinsicValue: number = 0,
  loopWeight: number = 1,  // Already defaulted to 1!
  cost: number = 1,
  // ...
)
```

## Tests Updated

### Backend (`packages/backend/src/server.test.ts`)

Updated test to verify new behavior:

**Before**:
```typescript
test('createFloatingAim - defaults intrinsicValue to 0', async () => {
  // Single test expecting 0
});
```

**After**:
```typescript
test('createFloatingAim - first aim defaults intrinsicValue to 1000', async () => {
  // First aim should be 1000
  const firstAim = await createFloatingAim({ text: 'First Aim' });
  assert.equal(firstAim.intrinsicValue, 1000);

  // Second aim should be 0
  const secondAim = await createFloatingAim({ text: 'Second Aim' });
  assert.equal(secondAim.intrinsicValue, 0);
});
```

## User Impact

### Before
1. User creates first aim → has no intrinsic value → no value flows through graph
2. User creates sub-aims → they have `loopWeight = 0` → they don't retain their own value
3. User must manually set intrinsic value and loop weights

### After
1. User creates first aim → automatically gets 1k intrinsic value → value flows immediately
2. User creates sub-aims → they retain their own value by default (`loopWeight = 1`)
3. User can override defaults if needed, but sensible defaults work out of the box

## Example Workflow

```
New Project:
1. Create "Launch Product" (first aim)
   → intrinsicValue: 1000 (automatic!)
   → loopWeight: 1 (retains its own value)

2. Create sub-aim "Build MVP"
   → intrinsicValue: 0 (child aim, no inherent value)
   → loopWeight: 1 (retains distributed value from parent)

3. Create sub-aim "Market Research"
   → intrinsicValue: 0
   → loopWeight: 1

Value Flow:
- "Launch Product" has 1k intrinsic value
- Distributes value to "Build MVP" and "Market Research"
- Each sub-aim retains its received value (loopWeight = 1)
- Priority calculation works immediately without manual setup
```

## Migration

**No migration needed!**
- Existing aims keep their current values
- Only affects newly created aims
- Users can still manually set any value

## Test Results

✅ All 19 backend tests pass
✅ All 2 shared tests pass

```bash
npm run test:unit:backend
# tests 19, pass 19, fail 0

npm run test:unit:shared
# tests 2, pass 2, fail 0
```
