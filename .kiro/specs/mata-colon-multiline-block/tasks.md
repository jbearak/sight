# Implementation Plan: mata: Multiline Block Detection

## Overview

This implementation fixes the lexer to correctly detect when `mata:` or `python:` followed by a newline (or only comments) should start a multi-line block instead of being treated as an inline expression. The fix is localized to the lexer's `scanWord` method.

## Tasks

- [ ] 1. Add helper method for lookahead detection
  - [ ] 1.1 Implement `is_only_whitespace_or_comment_until_newline()` method in StataLexer
    - Add method after `is_end_at_statement_boundary()` 
    - Handle whitespace (space, tab)
    - Handle `//` line comments
    - Handle `/* */` block comments
    - Handle `*` line comments (valid at statement boundary)
    - Return true if only whitespace/comments until newline/EOF
    - _Requirements: 1.1, 1.3, 1.4, 3.1, 3.3, 3.4_

  - [ ] 1.2 Write property test for lookahead detection
    - **Property 1: Colon-Newline Block Start Detection**
    - **Validates: Requirements 1.1, 1.3, 1.4, 3.1, 3.3, 3.4**

- [ ] 2. Modify scanWord to use lookahead for mata:
  - [ ] 2.1 Update mata: handling in scanWord
    - After consuming colon, call `is_only_whitespace_or_comment_until_newline()`
    - If true: emit `MATA_START` and push Mata context
    - If false: emit `MATA_INLINE` (existing behavior)
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ] 2.2 Write property test for mata: inline vs block detection
    - **Property 2: Colon-Content Inline Detection**
    - **Validates: Requirements 1.2, 2.1, 2.2, 2.3**

- [ ] 3. Modify scanWord to use lookahead for python:
  - [ ] 3.1 Update python: handling in scanWord
    - After consuming colon, call `is_only_whitespace_or_comment_until_newline()`
    - If true: emit `PYTHON_START` and push Python context
    - If false: emit `PYTHON_INLINE` (existing behavior)
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [ ] 3.2 Write property test for python: inline vs block detection
    - **Property 2: Colon-Content Inline Detection (python variant)**
    - **Validates: Requirements 3.2**

- [ ] 4. Checkpoint - Verify basic functionality
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Write property tests for block termination
  - [ ] 5.1 Write property test for end delimiter detection
    - **Property 3: Block Termination with end**
    - **Validates: Requirements 4.1, 4.2**

  - [ ] 5.2 Write property test for non-boundary end preservation
    - **Property 4: Non-Boundary end Preservation**
    - **Validates: Requirements 4.3**

- [ ] 6. Write property test for embedded content tokenization
  - [ ] 6.1 Write property test for embedded content
    - **Property 5: Embedded Content Tokenization**
    - **Validates: Requirements 5.1, 5.2, 5.3**

- [ ] 7. Unskip and verify the existing test
  - [ ] 7.1 Unskip the test in ast-formatter-string-literal-preservation.prop.test.ts
    - Change `it.skip` to `it` for "should preserve embedded Mata block with string literals"
    - Run the test to verify it passes
    - _Requirements: 6.1, 6.2_

- [ ] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- The fix is localized to `src/lexer/index.ts` - no other files need modification for core functionality
