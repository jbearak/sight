# Implementation Plan: Token-Only Macro Forward Reference Detection

## Overview

This implementation extends forward reference detection to token-only macro references by adding line-based position comparison. The changes are localized to `src/analyzer/index.ts`.

## Prerequisites

- Parent spec (forward-macro-reference-detection) must be implemented first
- `definition_index` field already exists on MacroSymbol

## Tasks

- [x] 1. Add definition_line field to MacroSymbol type
  - Add optional `definition_line?: number` field to MacroSymbol interface
  - This stores the line number where the macro was first defined
  - _Requirements: 3.1_

- [x] 2. Store definition_line when registering macros
  - [x] 2.1 Update process_macro_def
    - Store `definition_line` from node.range.start.line
    - Preserve existing definition_line if macro already exists (first definition wins)
    - _Requirements: 2.3_
  - [x] 2.2 Update process_loop
    - Store `definition_line` for loop variables
    - _Requirements: 2.3_
  - [x] 2.3 Update extract_tempvar_macro
    - Store `definition_line` for tempvar/tempfile/tempname macros
    - _Requirements: 2.3_
  - [x] 2.4 Update extract_unab_macro
    - Store `definition_line` for unab macros
    - _Requirements: 2.3_
  - [x] 2.5 Update register_implicit_locals
    - Store `definition_line` for syntax command implicit locals
    - _Requirements: 2.3_

- [x] 3. Modify is_macro_defined for line-based checking
  - Add optional `reference_line?: number` parameter
  - When reference_line is provided and macro has definition_line:
    - Return false if definition_line > reference_line (forward reference)
  - Skip line check for workspace globals
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 4. Update check_token_macro_references to pass token line
  - Extract token line from token.range.start.line
  - Pass token line to is_macro_defined as reference_line parameter
  - Do this for both MACRO_REF_LOCAL and MACRO_REF_GLOBAL tokens
  - _Requirements: 1.1, 1.3_

- [x] 5. Write property test for token forward reference detection
  - **Property 1: Token forward references produce warnings**
  - Generate code with token-only macro references before definitions
  - Verify analyzer produces undefined macro warning
  - Minimum 100 iterations
  - **Validates: Requirements 1.1, 1.3**

- [x] 6. Write property test for token properly-ordered references
  - **Property 2: Token properly-ordered references produce no warnings**
  - Generate code with token-only macro references after definitions
  - Verify analyzer produces no undefined macro warning
  - Include workspace global case
  - Minimum 100 iterations
  - **Validates: Requirements 1.2, 1.4**

- [x] 7. Write property test for token-AST consistency
  - **Property 3: Token-AST consistency**
  - Generate macro references that exist in both AST and token form
  - Verify forward reference detection produces identical results
  - Minimum 100 iterations
  - **Validates: Requirements 2.1, 2.2**

- [x] 8. Write unit tests for edge cases
  - Test token reference before definition → warning
  - Test token reference after definition → no warning
  - Test token reference to workspace global → no warning
  - Test token reference with multiple definitions (first definition wins)
  - Test token and definition on same line → no warning
  - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.3**

- [x] 9. Checkpoint - Run tests and verify
  - Run `bun test` to execute all tests
  - Verify all new tests pass
  - Verify full test suite passes (no regressions)
  - Verify property tests complete 100+ iterations
  - If tests fail: fix issues and re-run until all pass
  - Ask user if questions arise

## Notes

- All tasks are required
- This spec depends on forward-macro-reference-detection being implemented first
- Line-based comparison is simpler than preorder indices but has a known limitation: same-line ordering with `#delimit ;` won't be perfectly handled for token-only references
- This is acceptable because token-only references are rare edge cases and AST-based detection handles most same-line cases
