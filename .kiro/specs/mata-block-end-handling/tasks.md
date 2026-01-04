# Implementation Plan: Mata Block End Handling

## Overview

This plan implements fixes for bugs in Mata/Python embedded language block handling:
1. Indentation diagnostic false positive on `end` statements
2. Formatter deleting `end` statements and subsequent code (multi-line blocks)
3. Formatter deleting all code after single-line `mata:` or `python:` calls

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

- [x] 5. Fix IndentationAnalyzer (Formatter) to handle embedded_block nodes
  - [x] 5.1 Add embedded_block to is_block_node method
    - Add `node.type === 'embedded_block'` check
    - _Requirements: 4.1_

  - [x] 5.2 Add process_embedded_block_node method
    - Set start line depth at current_depth
    - Set end line depth at current_depth (same as start)
    - Do NOT recurse into embedded content
    - _Requirements: 4.2, 4.3, 4.4, 4.5_

  - [x] 5.3 Update walk_node to handle embedded_block before general block processing
    - Check for embedded_block type early
    - Call process_embedded_block_node and return
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 5.4 Fix extract_block_content to strip leading whitespace from first line
    - Strip leading whitespace from first line to prevent double-indentation
    - Formatter handles indentation, so original whitespace should be removed
    - _Requirements: 4.2_

  - [x] 5.5 Write property test for formatter embedded block indentation
    - **Property 3: Formatter embedded block indentation correctness**
    - Generate Mata/Python blocks at various nesting depths
    - Verify formatter doesn't add extra indentation to opening delimiter
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**

- [x] 6. Final checkpoint - Verify all fixes
  - Run the reproduction test (tests/repro_mata_indent.test.ts)
  - Ensure formatter doesn't over-indent mata keyword
  - Run full test suite
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Fix CodeFormatter to handle single-line embedded calls
  - [x] 7.1 Fix replace_range_in_content to clamp end character position
    - Calculate actual line length before computing end offset
    - Clamp end character to actual line length to prevent overflow
    - _Requirements: 5.3_

  - [x] 7.2 Write unit test for single-line mata: call preservation
    - Test that code after `mata: function()` is preserved
    - Test that code after `python: code` is preserved
    - _Requirements: 5.1, 5.2_

  - [x] 7.3 Write property test for single-line embedded call preservation
    - **Property 4: Formatter preservation for single-line embedded calls**
    - Generate documents with single-line `mata:` or `python:` calls and code after them
    - Verify all statements preserved after formatting
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**

- [x] 8. Final checkpoint - Verify single-line fix
  - Run the reproduction test (tests/repro_mata_inline.test.ts)
  - Ensure code after single-line mata: calls is preserved
  - Run full test suite
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- The reproduction test already exists and will verify the fixes
- Bugs 1 and 2 share the same root cause (context range vs AST range mismatch)
- Task 5 addresses a separate but related issue: the formatter's IndentationAnalyzer doesn't recognize embedded_block nodes, causing the `mata` keyword to be over-indented
- Task 7 addresses a new bug: single-line `mata:` calls use MAX_SAFE_INTEGER as end character, causing overflow in replace_range_in_content
- The IndentationDiagnosticAnalyzer (for warnings) was fixed in Task 1, but the IndentationAnalyzer (for formatting) needs the same fix
