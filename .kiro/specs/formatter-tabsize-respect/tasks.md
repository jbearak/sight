# Implementation Plan: Formatter TabSize Respect

## Overview

Fix the `IndentationAnalyzer` to use the configured `indent_size` instead of a hardcoded value of 4. This involves passing the config through from `SourcePreservingFormatter` to the analyzer.

## Tasks

- [x] 1. Update IndentationAnalyzer to accept indent_size parameter
  - Modify constructor to accept `indent_size: number = 4` parameter
  - Remove hardcoded `private indent_size = 4;` initialization
  - _Requirements: 1.1, 1.2_

- [x] 2. Update SourcePreservingFormatter to pass indent_size
  - Pass `config.indent_size` to `IndentationAnalyzer` constructor
  - _Requirements: 1.1_

- [x] 3. Add regression test for the reported bug
  - Add test case with nested if block, continuation lines, tabSize=2
  - Verify inner content is indented at 4 spaces (2 levels × 2 spaces)
  - _Requirements: 2.1, 2.2_

- [x] 4. Write property test for indentation depth correctness
  - **Property 1: Indentation Depth Correctness**
  - **Validates: Requirements 1.2, 2.2, 2.3**

- [x] 5. Write property test for formatting idempotency
  - **Property 2: Formatting Idempotency**
  - **Validates: Requirements 1.3**

- [x] 6. Write property test for continuation lines
  - **Property 3: Continuation Lines Don't Affect Block Depth**
  - **Validates: Requirements 2.1, 2.4**

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required for comprehensive coverage
- The fix is minimal: just two files need changes
- Default value of 4 ensures backward compatibility
