# Implementation Plan: TypeScript Type Check Integration

## Overview

Add TypeScript compiler type checking to the test workflow by modifying npm scripts in both root and client `package.json` files.

## Tasks

- [x] 1. Add typecheck script to root package.json
  - Add `"typecheck": "tsc --noEmit && cd client && tsc --noEmit"` to scripts
  - _Requirements: 1.1, 1.2, 1.3, 3.1, 3.2_

- [x] 2. Add typecheck script to client package.json
  - Add `"typecheck": "tsc --noEmit"` to scripts
  - _Requirements: 3.1, 3.2_

- [x] 3. Update test script in root package.json
  - Change `"test": "bun test"` to `"test": "bun run typecheck; bun test"`
  - Using `;` ensures tests run even if typecheck fails (see all errors at once)
  - _Requirements: 2.1, 2.2, 2.3_

- [x] 4. Verify implementation
  - Run `bun run typecheck` and confirm it passes (no existing type errors)
  - Run `bun test` and confirm type checking runs before tests
  - _Requirements: 1.2, 1.3, 2.1_

## Notes

- Using `;` instead of `&&` allows tests to run even if typecheck fails
- Type checking is fast, so no need for a separate "quick" test script
