# Implementation Plan: Trailing Whitespace Removal

## Overview

Implement trailing whitespace removal in the Stata LSP formatter by adding a post-processing step that strips trailing spaces and tabs from each line of formatted output.

## Tasks

- [x] 1. Implement trailing whitespace removal helper
  - [x] 1.1 Add `strip_trailing_whitespace()` private method to `CodeFormatter` class
    - Add method that splits content by newlines, applies `trimEnd()` to each line, and rejoins
    - _Requirements: 1.1, 1.3_

- [x] 2. Integrate trailing whitespace removal into formatter paths
  - [x] 2.1 Apply `strip_trailing_whitespace()` in `format_without_embedded_blocks()`
    - Call helper on `formatted_text` before returning TextEdit
    - _Requirements: 3.1_
  - [x] 2.2 Apply `strip_trailing_whitespace()` in `format_with_embedded_preservation()`
    - Call helper on `my_formatted_content` before returning TextEdit
    - _Requirements: 3.1_
  - [x] 2.3 Apply `strip_trailing_whitespace()` in `format_with_ast()`
    - Call helper on `formatted_text` before returning TextEdit
    - _Requirements: 3.2_
  - [x] 2.4 Apply `strip_trailing_whitespace()` in `format_with_comment_normalization()`
    - Call helper on `the_normalized_text` before returning TextEdit
    - _Requirements: 3.1, 3.2_

- [x] 3. Checkpoint - Verify basic functionality
  - Ensure formatter compiles and basic formatting still works
  - Run existing formatter tests to verify no regressions

- [x] 4. Write property tests for trailing whitespace removal
  - [x] 4.1 Write property test for no trailing whitespace in output
    - **Property 1: No Trailing Whitespace in Output**
    - **Validates: Requirements 1.1, 1.3, 3.1, 3.2**
  - [x] 4.2 Write property test for content preservation
    - **Property 2: Non-Whitespace Content Preservation**
    - **Validates: Requirements 2.1**
  - [x] 4.3 Write property test for line count preservation
    - **Property 3: Line Count Preservation**
    - **Validates: Requirements 2.2**
  - [x] 4.4 Write property test for string literal preservation
    - **Property 4: String Literal Content Preservation**
    - **Validates: Requirements 1.4**
  - [x] 4.5 Write property test for continuation line handling
    - **Property 5: Continuation Line Trailing Whitespace Removal**
    - **Validates: Requirements 2.3**

- [ ] 5. Final checkpoint - Ensure all tests pass
  - Run full test suite including new property tests
  - Verify both formatter modes handle trailing whitespace correctly

## Notes

- Each task references specific requirements for traceability
- Property tests validate universal correctness properties
- All formatter tests should use dual-mode testing helpers
