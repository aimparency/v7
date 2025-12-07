# Development Hints

Store useful things about the development process in this file.

## Testing with Playwright

### Run a specific test file
```bash
npx playwright test e2e/navigation.spec.ts
```

### Run a specific test case (by title)
```bash
npx playwright test -g "search finds deep nested aim"
```

### Debugging
Use the `--debug` flag to open the Playwright inspector:
```bash
npx playwright test e2e/navigation.spec.ts --debug
```
