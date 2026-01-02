# Implementation Plan: Current File Forward Call Resolution

## Overview

Extend the ScopeResolver to process forward calls (both directives and commands) from the current file, making symbols from target files visible in hover, completion, and diagnostics after the call site line.

## Tasks

- [x] 1. Add forward call resolution to ScopeResolver
  - [x] 1.1 Parse forward calls from current file in resolve()
    - Combine forward calls from directives (@lsp-do, @lsp-run, @lsp-include) and commands (do, run, include)
    - _Requirements: 1.1, 1.2, 1.5, 1.6, 1.7_

  - [x] 1.2 Resolve forward call targets using ForwardScopeResolver
    - Apply inheritance rules (include = all symbols, do/run = non-locals only)
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 1.3 Track visibility line for forward call symbols
    - Each symbol should know after which line it becomes visible
    - _Requirements: 2.1, 2.2_

- [x] 2. Extend ResolvedScope with forward call symbols
  - [x] 2.1 Add forward_call_symbols field to ResolvedScope interface
    - Include visibility_after_line for each symbol
    - _Requirements: 2.1, 2.2_

  - [x] 2.2 Merge forward call symbols in resolve() output
    - _Requirements: 1.3_

- [x] 3. Update HoverProvider for position-aware lookup
  - [x] 3.1 Check forward_call_symbols with position filtering
    - Only include symbols where cursor line > visibility_after_line
    - _Requirements: 2.1, 3.1, 3.2_

- [x] 4. Update CompletionProvider for position-aware lookup
  - [x] 4.1 Check forward_call_symbols with position filtering
    - Only include symbols where cursor line > visibility_after_line
    - _Requirements: 2.2, 2.3_

- [x] 5. Handle diagnostics for missing forward call targets
  - [x] 5.1 Emit warning when forward call target file not found
    - _Requirements: 1.4_

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Write integration tests for directives
  - [x] 7.1 Test hover with @lsp-include directive
    - Verify local macros from included file appear in hover
    - _Requirements: 1.1, 3.1_

  - [x] 7.2 Test hover with @lsp-do directive
    - Verify non-local symbols appear, locals do not
    - _Requirements: 1.2, 3.1_

  - [x] 7.3 Test position-aware visibility with directives
    - Verify symbols not visible before directive line
    - _Requirements: 2.1, 2.2_

- [x] 8. Write integration tests for commands
  - [x] 8.1 Test hover with include command
    - Verify local macros from included file appear in hover (same as directive)
    - _Requirements: 1.1, 1.7, 3.1_

  - [x] 8.2 Test hover with do command
    - Verify non-local symbols appear, locals do not (same as directive)
    - _Requirements: 1.2, 1.5, 3.1_

  - [x] 8.3 Test hover with run command
    - Verify non-local symbols appear, locals do not (same as directive)
    - _Requirements: 1.2, 1.6, 3.1_

  - [x] 8.4 Test position-aware visibility with commands
    - Verify symbols not visible before command line
    - _Requirements: 2.1, 2.2_

- [x] 9. Write integration tests for duplicate handling and forward-only resolution
  - [x] 9.1 Test do-then-include adds only locals
    - File referenced via do, then include should add locals on second reference
    - _Requirements: 4.1_

  - [x] 9.2 Test include-then-do skips second reference
    - File referenced via include first should skip subsequent do/run
    - _Requirements: 4.2_

  - [x] 9.3 Test forward resolution does not follow backward directives
    - Target file with @lsp-done-by should not inherit from its parent
    - _Requirements: 5.1, 5.2_

- [x] 10. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- The ForwardScopeResolver already handles inheritance rules
- The DirectiveParser parses forward call directives (@lsp-do, @lsp-run, @lsp-include)
- The Analyzer extracts forward calls from commands (do, run, include)
- The ScopeResolver.parse_content() combines forward calls from both sources
- Main work is wiring these together and adding position-aware filtering
- Both directives and commands should be treated equivalently for symbol inheritance
