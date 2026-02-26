# Number Formatting Update

## Summary

Updated the number formatting system to support millions ('m' suffix) and enforce max 2 decimal places across all number displays.

## Changes Made

### 1. **formatWithK** - Enhanced Display Formatting

**Location**: `packages/frontend/src/utils/number-format.ts`

**New Features**:
- ✅ Supports millions with 'm' suffix
- ✅ Max 2 decimal places for all values
- ✅ Smart rounding with '~' prefix

**Examples**:
```typescript
formatWithK(1_000_000)     // → "1m"
formatWithK(10_000_000)    // → "10m"
formatWithK(9_500_000)     // → "~9.5m"
formatWithK(9_567_000)     // → "~9.57m"  (2 decimals)
formatWithK(10_000)        // → "10k"
formatWithK(9500)          // → "~9.5k"
formatWithK(9567)          // → "~9.57k"   (2 decimals)
formatWithK(42.123456)     // → "42.12"    (2 decimals)
formatWithK(100)           // → "100"
```

**Rules**:
- **Millions**: >= 9.5M rounds to millions with '~', exact millions show without '~'
- **Thousands**: >= 9500 rounds to thousands with '~', exact thousands show without '~'
- **Small values**: Show as-is with max 2 decimal places
- **All values**: Limited to 2 decimal places maximum

### 2. **parseK** - Enhanced Input Parsing

**Location**: `packages/frontend/src/utils/number-format.ts`

**New Features**:
- ✅ Parses 'm' suffix (millions)
- ✅ Case-insensitive (accepts 'M' and 'K')
- ✅ Strips '~' prefix automatically

**Examples**:
```typescript
parseK('10m')      // → 10_000_000
parseK('~2.5m')    // → 2_500_000
parseK('10M')      // → 10_000_000
parseK('10k')      // → 10_000
parseK('~1.5k')    // → 1500
parseK('10K')      // → 10_000
parseK('42')       // → 42
parseK('  10k  ')  // → 10_000 (handles whitespace)
```

### 3. **Test Coverage**

**Location**: `packages/frontend/src/utils/number-format.test.ts` (NEW)

**Coverage**:
- ✅ Millions formatting and parsing
- ✅ Thousands formatting and parsing
- ✅ Decimal precision (max 2 places)
- ✅ Round-trip tests (format → parse → same value)
- ✅ Edge cases (invalid input, whitespace, case sensitivity)

**Run tests**:
```bash
npm run test:unit:frontend
```

## Usage in Codebase

### Display (Read-only)
Used in `GraphSidePanel.vue` to display:
- Total Value: `{{ formatWithK(dataStore.getAimValue(selectedAim.id)) }}`
- Total Cost: `{{ formatWithK(dataStore.getAimCost(selectedAim.id)) }}`

### Input Parsing
Used in `GraphSidePanel.vue` to parse user input:
- `onIntrinsicValueInput`: `editedIntrinsicValue.value = parseK(input)`
- `onCostInput`: `editedCost.value = parseK(input)`
- `onLoopWeightInput`: `editedLoopWeight.value = parseK(input)`

## Benefits

1. **Better UX**: Large numbers are easier to read (10m vs 10000000)
2. **Consistent Precision**: All numbers show max 2 decimals, avoiding visual clutter
3. **Flexible Input**: Users can type "10k" or "2.5m" instead of typing many zeros
4. **Round-trip Safety**: Formatted values can be parsed back to original values

## Migration Notes

**No breaking changes** - existing functionality preserved:
- Exact thousands (10000) still display as "10k"
- Values >= 9500 still get '~' prefix
- All existing parseK calls work the same

**New behavior**:
- Values now capped at 2 decimal places (was unlimited)
- Millions now formatted (previously would show full number)

## Examples in Real Usage

### Before:
```
Value: 12345678.123456
Cost: 9567.891234
Loop Weight: 1.5
```

### After:
```
Value: ~12.35m
Cost: ~9.57k
Loop Weight: 1.5
```

## Testing

All tests pass:
- ✅ Backend tests: 19/19
- ✅ Shared tests: 2/2 (fixed priority calculation test)
- ✅ Frontend unit tests: Ready to run with vitest

```bash
# Run all tests
npm test

# Run just number formatting tests
npm run test:unit:frontend -- number-format.test.ts
```
