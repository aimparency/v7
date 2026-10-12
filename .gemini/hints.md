# Development Hints

Store useful things about the development process in this file.

## Testing with Playwright

### Run a specific test file
```bash
pnpm exec playwright test e2e/navigation.spec.ts
```

### Run a specific test case (by title)
```bash
pnpm exec playwright test -g "search finds deep nested idea"
```

### Debugging
Use the `--debug` flag to open the Playwright inspector:
```bash
pnpm exec playwright test e2e/navigation.spec.ts --debug
```
