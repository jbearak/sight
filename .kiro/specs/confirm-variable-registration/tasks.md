# Implementation Plan: Confirm Variable Registration

## Overview

This implementation adds support for registering variables from `confirm variable` and `confirm var` commands in the Stata LSP's semantic analyzer. The implementation follows the existing pattern for variable-creating commands like `gen`, `egen`, `input`, and `rename`.

## Tasks

- [x] 1. Update VariableSymbol type to include 'confirm' source
  - Add `'confirm'` to the source union type in `src/types/index.ts`
  - _Requirements: 4.1_

- [x] 2. Implement confirm variable extraction in analyzer
  - [x] 2.1 Add extract_confirm_variable method to SemanticAnalyzer
    - Check if varlist has at least 2 items
    - Check if first item is "variable" or "var" (case-insensitive)
    - Register second item as VariableSymbol with source='confirm'
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - [x] 2.2 Add confirm command handling in process_command
    - Add else-if branch for `cmd_name === 'confirm'`
    - Call extract_confirm_variable method
    - _Requirements: 1.1_
  - [x] 2.3 Write property test for confirm variable registration
    - **Property 1: Confirm Variable Registration**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Write property test for prefixed confirm variable
  - **Property 2: Prefixed Confirm Variable Registration**
  - **Validates: Requirements 2.1, 2.2, 2.3, 2.4**

- [x] 5. Write property test for confirm variable with options
  - **Property 3: Confirm Variable with Options**
  - **Validates: Requirements 3.1, 3.2**

- [x] 6. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- The parser already handles prefix commands (capture, quietly, etc.) so no parser changes are needed
