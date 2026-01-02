# Implementation Plan: Quote Auto-Close (Quote Snippets)

## Overview

Migrate from the broken `type` command interceptor to a reliable `onDidChangeTextDocument` listener approach for Stata quote auto-closing.

## Tasks

- [x] 1. Update core logic for new approach
  - [x] 1.1 Modify `compute_quote_auto_close()` to return insert text instead of replacement text
    - Change return type to `{ handled, insert_text, cursor_offset }`
    - Simplify logic since we only need to determine what to insert after cursor
    - _Requirements: 1.1, 3.1, 5.1, 6.1, 7.1, 8.1_
  - [x] 1.2 Update unit tests for new return type
    - Update test helper to work with new interface
    - Verify all existing test cases still pass
    - _Requirements: 1.2, 3.2, 5.2, 6.2, 7.2, 8.2_

- [x] 2. Rewrite VS Code integration
  - [x] 2.1 Replace `type` command registration with `onDidChangeTextDocument` listener
    - Subscribe to `workspace.onDidChangeTextDocument`
    - Extract typed character from change event
    - Get text before/after cursor position
    - Call `compute_quote_auto_close()` and apply edit if handled
    - Add recursion guard to prevent re-triggering on our own edits
    - _Requirements: 1.1, 3.1, 5.1, 6.1, 7.1, 8.1_
  - [x] 2.2 Update cursor positioning after edit
    - Position cursor between opening and closing characters
    - Handle edge cases (end of line, empty document)
    - _Requirements: 1.2, 3.2, 5.2, 6.2, 7.2, 8.2_

- [x] 3. Update language configuration
  - [x] 3.1 Remove `"` → `"` from autoClosingPairs in `language-configuration.json`
    - Keep `{}`, `[]`, `()` pairs
    - Remove `""` pair to avoid conflicts with our listener
    - _Requirements: 9.1, 9.2, 9.3_

- [x] 4. Checkpoint - Build and manual test
  - Rebuild client extension: `bun run bundle` in client/
  - Reload VS Code window
  - Test each scenario manually:
    - `` ` `` → `` `|' ``
    - `` `` `` → `` ``|'' ``
    - `` `" `` → `` `"|"' ``
  - Ensure `{`, `[`, `(` still auto-close
  - Ask user if questions arise

- [x] 5. Clean up old implementation
  - [x] 5.1 Remove dead code from previous `type` interceptor approach
    - Remove any unused helper functions
    - Clean up imports
    - _Requirements: 9.5_

- [x] 6. Final checkpoint
  - Run `bun run typecheck` in client/
  - Run unit tests: `bun test tests/unit/quote-auto-close-core.test.ts`
  - Manual verification of all requirements
  - Ensure all tests pass, ask the user if questions arise

## Notes

- The `onDidChangeTextDocument` approach fires AFTER the character is inserted, so we insert closing characters rather than replacing text
- Recursion guard is critical to prevent infinite loops when we apply our own edits
- The `"` → `"` pair must be removed from language-configuration.json to avoid double-insertion conflicts
