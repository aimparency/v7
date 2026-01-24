# Testing Guide

## Overview

Aimparency uses a comprehensive testing strategy covering unit tests and e2e tests across all packages.

## Running Tests

### All Tests (Recommended for CI/Pre-commit)
```bash
npm test              # Runs all unit tests + e2e tests
# or
npm run test:all
```

### Unit Tests Only
```bash
npm run test:unit     # All unit tests across all packages
```

Individual package unit tests:
```bash
npm run test:unit:backend   # Backend unit tests (tsx --test)
npm run test:unit:frontend  # Frontend unit tests (vitest)
npm run test:unit:shared    # Shared package tests
npm run test:unit:mcp       # MCP server tests
```

### E2E Tests
```bash
npm run test:e2e           # Frontend e2e tests (playwright)
npm run test:e2e:ci        # E2E tests with CI config
```

### Watch Mode (for development)
```bash
npm run test:watch         # Frontend vitest in watch mode
```

## Test Structure

### Backend (`packages/backend`)
- **Framework**: Node.js native test runner (`tsx --test`)
- **Location**: `src/**/*.test.ts`
- **Coverage**:
  - API endpoints (aim, phase, system)
  - Value calculation
  - Semantic graph generation
  - Date parsing (smart dates)
  - Forces calculation

### Frontend (`packages/frontend`)
- **Unit Tests**:
  - Framework: Vitest
  - Location: `src/**/*.spec.ts`
  - Coverage: Components, composables, stores

- **E2E Tests**:
  - Framework: Playwright
  - Location: `e2e/**/*.spec.ts`
  - Coverage:
    - First aim creation
    - Navigation (keyboard, columns, phases)
    - Aim creation workflows
    - Phase management
    - Graph view drag-to-create
    - Search functionality
    - Settings modal

### Shared (`packages/shared`)
- **Framework**: tsx --test
- **Location**: `src/**/*.test.ts`
- **Coverage**: Shared utilities, types, calculations

### MCP (`packages/mcp`)
- **Framework**: tsx --test
- **Location**: `src/**/*.test.ts`
- **Coverage**: MCP server tools and handlers

## CI Integration

The test suite is designed to run in CI environments:

```yaml
# Example GitHub Actions workflow
- name: Run all tests
  run: npm test

# Or separate steps
- name: Unit tests
  run: npm run test:unit

- name: E2E tests
  run: npm run test:e2e:ci
```

## Writing Tests

### Backend Tests (Node.js Test Runner)
```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('description', async () => {
  // Use assert.ok, assert.equal, etc.
  assert.equal(actual, expected);

  // Floating point comparisons - use threshold
  assert.ok(Math.abs(actual - expected) < 0.01);
});
```

### Frontend Unit Tests (Vitest)
```typescript
import { describe, it, expect } from 'vitest';

describe('ComponentName', () => {
  it('should do something', () => {
    expect(value).toBe(expected);
  });
});
```

### E2E Tests (Playwright)
```typescript
import { test, expect } from '@playwright/test';

test('user flow description', async ({ page }) => {
  await page.goto('/');
  await page.click('.selector');
  await expect(page.locator('.result')).toBeVisible();
});
```

## Test Coverage

Current coverage:
- Backend: ✅ Core functionality (19 tests passing)
- Frontend E2E: ✅ Critical user flows (9 test files)
- Frontend Unit: 🟡 Partial (vitest configured, needs expansion)
- Shared: ✅ Core utilities
- MCP: ✅ Tool integration

## Known Issues

None! All tests passing as of latest commit.

## Future Improvements

- [ ] Add visual regression tests (Playwright screenshots)
- [ ] Add performance benchmarks
- [ ] Increase frontend unit test coverage
- [ ] Add integration tests for wrapped-agents
- [ ] Add mobile e2e tests (when mobile app ready)

## Debugging Failed Tests

### Backend tests fail
```bash
# Run with verbose output
NODE_ENV=test tsx --test src/**/*.test.ts

# Run single test file
NODE_ENV=test tsx --test src/forces.test.ts
```

### E2E tests fail
```bash
# Run in headed mode (see browser)
HEADED=true npm run test:e2e

# Debug specific test
npx playwright test e2e/graph-aim-drag-create.spec.ts --headed --debug
```

### Frontend unit tests fail
```bash
# Run in UI mode
npm run test:unit -w frontend -- --ui
```

## Test Maintenance

- Update e2e tests when UI changes significantly
- Keep test data minimal (use temp directories, cleanup in `finally`)
- Use floating-point thresholds for numerical comparisons
- Ensure .bowman directory exists in tests (use `fs.ensureDir`)
