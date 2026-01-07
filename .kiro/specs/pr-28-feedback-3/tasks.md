# Implementation Plan: PR-28-feedback-3

## Overview

This implementation plan addresses additional feedback from PR 28 by enhancing the parser to handle parenthesized varlist groups in frame-prefixed commands, improving test infrastructure consistency, and cleaning up code quality issues. The tasks are organized to implement parser enhancements first, followed by test infrastructure improvements and code quality fixes.

## Tasks

- [x] 1. Enhance parseCommandBody for LPAREN handling
  - Mirror the LPAREN handling logic from parseCommand (lines 895-935) into parseCommandBody's varlist loop
  - Add the same parenthesized group parsing logic that handles nested parentheses and spacing
  - Ensure parenthesized groups are properly added to the varlist with correct range information
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 1.1 Write property test for frame-prefixed parenthesized group parsing
  - **Property 1: Frame-Prefixed Command Parenthesized Group Recognition**
  - **Validates: Requirements 1.1, 1.5**

- [x] 1.2 Write property test for consistent parenthesized group parsing
  - **Property 2: Consistent Parenthesized Group Parsing**
  - **Validates: Requirements 1.2, 1.3**

- [x] 1.3 Write property test for post-parenthesis token parsing
  - **Property 3: Post-Parenthesis Token Parsing**
  - **Validates: Requirements 1.4**

- [x] 2. Fix frame prefix whitespace handling
  - Add skipTrivia() call after consuming the colon in parseFramePrefixedCommand
  - Update both direct frame statement path and parseCommand special case handling
  - Ensure consistent whitespace tolerance across all frame parsing paths
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 2.1 Write property test for frame prefix whitespace tolerance
  - **Property 4: Frame Prefix Whitespace Tolerance**
  - **Validates: Requirements 4.1, 4.2, 4.5**

- [x] 2.2 Write property test for frame parsing path consistency
  - **Property 5: Frame Parsing Path Consistency**
  - **Validates: Requirements 4.4**

- [x] 3. Checkpoint - Ensure parser tests pass
  - Ensure all parser enhancement tests pass, ask the user if questions arise.

- [x] 4. Update prefix command spacing tests for dual formatter mode
  - Replace fc.property with for_each_formatter_mode_property in Property 7 test
  - Update test to call formatWithMode(source, mode) instead of parseAndFormat
  - Wrap static example tests with for_each_formatter_mode_property
  - Maintain identical assertions for both formatter modes
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 5. Refactor test files to use shared document state helper
  - Update tests/property/unab-colon-field.prop.test.ts to import create_document_state from ./helpers
  - Remove local create_document_state implementation from unab-colon-field.prop.test.ts
  - Update tests/property/pretty-printer-frame-block-deletion.prop.test.ts to use shared helper
  - Remove local create_document_state implementation from pretty-printer-frame-block-deletion.prop.test.ts
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 6. Clean up unused imports and duplicate code
  - Remove unused for_each_formatter_mode import from ast-formatter-prefix-command-spacing.prop.test.ts
  - Verify all test files use shared helpers consistently
  - Remove any remaining duplicate helper implementations
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- Parser enhancements are implemented first to ensure core functionality
- Test infrastructure improvements follow to ensure comprehensive coverage
- Code quality improvements are applied last to clean up the codebase