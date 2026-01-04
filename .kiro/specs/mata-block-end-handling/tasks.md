# Implementation Plan: Mata Block End Handling

## Overview

This plan implements fixes for two related bugs in Mata/Python block `end` statement handling:
1. Indentation diagnostic false positive on `end` statements
2. Formatter deleting `end` statements and subsequent code

## Tasks

- [x] 1. Fix IndentationDiagnosticAnalyzer to handle embedded_block nodes
  - [x] 1.1 Add embedded_block handling in compute_expected_depths
    - Add check for `node.type === 'embedded_block'`
    - Set end line depth equal to start line depth (current_depth)
    - Return early without recursing into embedded content
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 1.2 Write property test for end delimiter indentation correctness
    - **Property 1: End delimiter indentation correctness**
    - Generate Mata/Python blocks at various nesting depths
    - Verify no unnecessary indentation diagnostics on properly indented `end` lines
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4**

- [x] 2. Fix CodeFormatter to include end delimiter in extracted content
  - [x] 2.1 Modify extract_block_content to include end delimiter line
    - Use `context_range.end_delimiter.range.start.line` for end line
    - Fall back to `context_range.range.end.line` if no end_delimiter
    - _Requirements: 2.3, 3.1, 3.2_

  - [x] 2.2 Modify format_with_embedded_preservation to use correct range
    - Calculate actual_end_line from end_delimiter
    - Use actual range when calling replace_range_in_content
    - _Requirements: 2.1, 2.2, 2.4_

  - [x] 2.3 Write property test for formatter round-trip preservation
    - **Property 2: Formatter round-trip preservation for embedded blocks**
    - Generate documents with Mata/Python blocks and code after them
    - Verify all statements preserved after formatting
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2**

- [x] 3. Checkpoint - Verify fixes with reproduction test
  - Run the reproduction test (tests/repro_mata_indent.test.ts)
  - Ensure both test cases pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Final checkpoint - Ensure all tests pass
  - Run full test suite
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- The reproduction test already exists and will verify the fixes
- Both bugs share the same root cause (context range vs AST range mismatch)
