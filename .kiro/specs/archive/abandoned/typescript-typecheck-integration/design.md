# Design Document: TypeScript Type Check Integration

## Overview

This design adds TypeScript compiler type checking to the project's test workflow. The implementation modifies `package.json` scripts in both the root project and client package to ensure type errors are caught during development, not just at build time.

The solution uses `tsc --noEmit` to perform type checking without generating output files, making it fast and suitable for integration into the test workflow.

## Architecture

```
Developer runs `bun test`
         │
         ├──────────────────────────────┐
         ▼                              ▼
┌─────────────────────┐    ┌─────────────────────┐
│  tsc --noEmit       │    │  bun test           │
│  (root + client)    │    │  (unit/property)    │
└─────────────────────┘    └─────────────────────┘
         │                              │
         ▼                              ▼
    Type errors?                  Test failures?
         │                              │
         └──────────────┬───────────────┘
                        ▼
              Exit with combined status
              (non-zero if either failed)
```

The design runs type checking and tests in parallel conceptually, but for simplicity we run them sequentially and continue even if type checking fails. This way developers see all issues in one run.

## Components and Interfaces

### Script Changes

**Root package.json scripts:**

| Script | Command | Purpose |
|--------|---------|---------|
| `typecheck` | `tsc --noEmit && cd client && tsc --noEmit` | Standalone type checking for both packages |
| `test` | `bun run typecheck; bun test` | Run type check then tests (shows all errors) |

**Client package.json scripts:**

| Script | Command | Purpose |
|--------|---------|---------|
| `typecheck` | `tsc --noEmit` | Standalone type checking for client |

### Execution Flow

**`bun test`:**
1. Run `tsc --noEmit` on root and client (report errors but continue)
2. Run `bun test`
3. Exit with non-zero if any step failed

Using `;` instead of `&&` ensures tests run even if type checking fails, so you see all issues in one run.

### Configuration

Both packages already have `tsconfig.json` files with `strict: true` enabled. No changes to TypeScript configuration are needed.

The root `tsconfig.json` excludes test files (`**/*.test.ts`, `**/*.spec.ts`) from compilation but `tsc --noEmit` will still type-check them since they import from `src/`.

## Data Models

No new data models are required. This feature only modifies npm scripts.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Type check exit code reflects type correctness

*For any* TypeScript codebase state, running `bun run typecheck` SHALL exit with code 0 if and only if there are no type errors in the source files.

**Validates: Requirements 1.2, 1.3**

### Property 2: Test script fails on type errors

*For any* TypeScript codebase state with type errors, running `bun test` SHALL exit with a non-zero status code before executing any unit tests.

**Validates: Requirements 2.1, 2.2**

### Property 3: Test script succeeds when all checks pass

*For any* TypeScript codebase state with no type errors and all unit tests passing, running `bun test` SHALL exit with code 0.

**Validates: Requirements 2.3**

## Error Handling

| Scenario | `bun test` |
|----------|------------|
| Type check fails | Show errors, continue to tests, exit non-zero |
| Tests fail | Exit with test exit code |
| All checks pass | Exit 0 |

Using `;` runs tests regardless of typecheck result, so you see all issues at once.

## Testing Strategy

### Manual Verification

Since this feature modifies npm scripts (not application code), testing is manual:

1. **Introduce a type error** in `src/` and verify `bun run typecheck` fails
2. **Introduce a type error** in `client/src/` and verify `bun run typecheck` fails
3. **Fix type errors** and verify `bun run typecheck` passes
4. **Run `bun test`** and verify type checking runs before tests
5. **Introduce a type error** and verify `bun test` fails before running tests

### Verification Commands

```bash
# Should pass (assuming no existing type errors)
bun run typecheck

# Should fail fast on type errors
echo "const x: number = 'string';" >> src/temp-error.ts
bun run typecheck  # Should fail
rm src/temp-error.ts

# Test integration
bun test  # Should run typecheck first, then tests
```
