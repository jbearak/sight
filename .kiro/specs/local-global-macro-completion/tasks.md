# Implementation Plan: Local vs. Global Macro Completion Filtering

## Overview

This plan implements fixes to ensure the completion provider correctly filters local and global macros based on the prefix character used. The main work involves verifying the completion provider uses the correct macro map based on scope and ensuring consistent labeling in completion items.

## Tasks

- [x] 1. Verify and fix macro completion filtering in completion provider
  - [x] 1.1 Review `get_macro_completions` method in `src/providers/completion.ts`
    - Verify it correctly uses `symbols.localMacros` when scope is 'local'
    - Verify it correctly uses `symbols.globalMacros` when scope is 'global'
    - _Requirements: 1.5, 1.6, 2.6, 2.7_

  - [x] 1.2 Ensure detail field uses consistent format
    - Update detail field to always use format: `"${scope} macro"` (e.g., "local macro" or "global macro")
    - Remove any conditional logic that might produce different labels
    - _Requirements: 3.1, 3.2_

  - [x] 1.3 Verify context detection correctly identifies macro scope
    - Review `detect_macro_context` function to ensure it returns correct scope
    - Verify backtick (`` ` ``) returns `{ type: 'macro', scope: 'local' }`
    - Verify dollar sign (`$`) returns `{ type: 'macro', scope: 'global' }`
    - _Requirements: 1.1, 2.1_

- [x] 2. Write unit tests for macro completion filtering
  - [x] 2.1 Test local macro filtering with backtick prefix
    - Test that backtick prefix returns only local macros
    - Test that backtick prefix does NOT return global macros
    - _Requirements: 1.5, 1.6_

  - [x] 2.2 Test global macro filtering with dollar prefix
    - Test that dollar prefix returns only global macros
    - Test that dollar prefix does NOT return local macros
    - _Requirements: 2.6, 2.7_

  - [x] 2.3 Test macro labeling
    - Test that local macros have "local macro" in detail field
    - Test that global macros have "global macro" in detail field
    - _Requirements: 3.1, 3.2_

  - [x] 2.4 Test mixed local and global definitions
    - Test with both local and global macros with same name
    - Test backtick prefix returns only local
    - Test dollar prefix returns only global
    - _Requirements: 4.1, 4.2_

  - [x] 2.5 Test order-independent filtering
    - Test with global defined before local, backtick prefix returns local
    - Test with local defined before global, dollar prefix returns global
    - _Requirements: 1.4, 2.5_

- [x] 3. Checkpoint - Verify unit tests pass
  - Ensure all unit tests pass, ask the user if questions arise.

- [x] 4. Write property-based tests for macro completion
  - [x] 4.1 Property test: Backtick prefix returns only local macros
    - **Property 1: Backtick Prefix Returns Only Local Macros**
    - **Validates: Requirements 1.5, 1.6**

  - [x] 4.2 Property test: Dollar prefix returns only global macros
    - **Property 2: Dollar Prefix Returns Only Global Macros**
    - **Validates: Requirements 2.6, 2.7**

  - [x] 4.3 Property test: Local macros labeled correctly
    - **Property 3: Local Macros Labeled as "local macro"**
    - **Validates: Requirements 3.1, 3.3**

  - [x] 4.4 Property test: Global macros labeled correctly
    - **Property 4: Global Macros Labeled as "global macro"**
    - **Validates: Requirements 3.2, 3.4**

  - [x] 4.5 Property test: Backtick filtering independent of order
    - **Property 5: Backtick Filtering Independent of Definition Order**
    - **Validates: Requirements 1.4, 4.1**

  - [x] 4.6 Property test: Dollar filtering independent of order
    - **Property 6: Dollar Filtering Independent of Definition Order**
    - **Validates: Requirements 2.5, 4.2**

  - [x] 4.7 Property test: Shadowing respects scope rules
    - **Property 7: Shadowing Respects Scope Rules**
    - **Validates: Requirements 4.3**

  - [x] 4.8 Property test: Analyzer classifies local macros correctly
    - **Property 8: Analyzer Classifies Local Macros Correctly**
    - **Validates: Requirements 5.1, 5.3**

  - [x] 4.9 Property test: Analyzer classifies global macros correctly
    - **Property 9: Analyzer Classifies Global Macros Correctly**
    - **Validates: Requirements 5.2, 5.3**

- [x] 5. Checkpoint - Verify property tests pass
  - Ensure all property tests pass, ask the user if questions arise.

- [x] 6. Final checkpoint - Run full test suite
  - Run: `bun test`
  - Ensure all tests pass (unit, integration, and property-based)
  - Verify no regressions in other completion functionality

## Notes

- All tasks are required for comprehensive coverage
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- The analyzer already correctly classifies macros, so no changes needed there
- Context detection already correctly identifies macro scope, so no changes needed there
- Main focus is on the completion provider's filtering and labeling logic

