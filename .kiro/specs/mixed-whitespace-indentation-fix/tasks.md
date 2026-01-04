# Implementation Plan: Mixed Whitespace Indentation Fix

## Overview

Fix the `get_line_indentation` method in `IndentationDiagnosticAnalyzer` to correctly compute visual width when lines contain mixed tabs and spaces. The current implementation treats tabs as a fixed width, but tabs should advance to the next tab stop.

## Tasks

- [x] 1. Fix get_line_indentation to use proper tab-stop calculation
  - Modify `src/providers/indentation-diagnostics.ts`
  - Change tab handling from `level += indent_size` to `visual_column = Math.ceil((visual_column + 1) / indent_size) * indent_size`
  - Rename variable from `level` to `visual_column` for clarity
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. Write property test for visual width calculation
  - **Property 1: Visual Width Calculation Correctness**
  - Test that spaces add 1 to visual column
  - Test that tabs advance to next multiple of indent_size
  - Test mixed whitespace combinations
  - **Validates: Requirements 1.1**

- [x] 3. Write property test for no false positives
  - **Property 2: No False Positive When Visual Width Equals Expected**
  - Generate lines with mixed whitespace that produce correct visual width
  - Verify no unnecessary indentation diagnostic is emitted
  - **Validates: Requirements 1.2, 1.4**

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Write property test for formatter resolves diagnostics
  - **Property 6: Formatter Resolves All Indentation Diagnostics**
  - Generate code that triggers indentation diagnostics
  - Format the code
  - Verify diagnostics are resolved
  - **Validates: Requirements 3.1, 3.2, 3.3**

- [x] 6. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required for comprehensive testing
- The fix is a single-line change in `get_line_indentation`
- The formatter should already work correctly once the diagnostic is fixed
- Property tests validate the fix works for all whitespace combinations
