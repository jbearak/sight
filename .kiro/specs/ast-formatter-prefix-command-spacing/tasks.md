# Implementation Plan: AST Formatter Prefix Command Spacing

## Overview

This plan addresses critical bugs in the PrettyPrinter (AST formatter) that cause it to produce syntactically invalid Stata code. The formatter incorrectly handles spacing around colons in prefix commands, drops varlists, and mishandles commas before options.

## Tasks

- [x] 1. Analyze current PrettyPrinter implementation and identify bug locations
  - Review `printPrefix()` method to understand current colon handling
  - Review `printCommand()` method to understand varlist and option handling
  - Identify where newlines are incorrectly inserted after colons
  - Identify where varlists are being dropped
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 3.1, 3.2, 4.1_
  
  **Analysis Results:**
  - Bug 1: Parser consumes colons after prefix commands (line 702-705) but doesn't store `has_colon` in PrefixNode
  - Bug 2: `printPrefix()` only adds colon for `by` prefix, ignoring other prefix commands with colons
  - Bug 3: `unab` command parser consumes colon but doesn't store it - varlist has no colon indicator
  - Bug 4: `frame bh: command` is parsed as `frame` command with varlist `[bh]`, losing the colon and subsequent command
  - Bug 5: `rename *, lower` - the `*` is tokenized as OPERATOR, not included in varlist
  - Root cause: PrefixNode interface lacks `has_colon` field; parser doesn't preserve colon information

- [x] 2. Fix prefix command colon spacing
  - [x] 2.1 Update `printPrefix()` to detect and preserve colons for all prefix commands
    - Added `has_colon` field to PrefixNode interface in types/index.ts
    - Updated parser to set `has_colon = true` when consuming colon after prefix
    - Updated `printPrefix()` to use `has_colon` instead of checking for `by` prefix
    - Added special handling for `frame name:` prefix syntax in parseCommand() and parseFrameBlock()
    - _Requirements: 1.1, 1.2, 1.3, 5.1, 5.2, 5.3_

  - [x] 2.2 Write property test for prefix colon spacing
    - **Property 1: Prefix Colon Spacing**
    - **Validates: Requirements 1.1, 1.2, 1.3**
    - Created tests/property/ast-formatter-prefix-command-spacing.prop.test.ts

  - [x] 2.3 Write unit tests for prefix colon examples
    - Test `capture frame this: that` formats with space after colon
    - Test `frame bh: unab raw_vars_bh _all` formats with space after colon
    - Test multiple prefix commands with colons
    - _Requirements: 1.1, 1.2, 7.1, 7.2, 7.3_

- [ ] 3. Fix colon qualifier preservation
  - [ ] 3.1 Ensure colons in commands like `unab` are preserved
    - Review how colon qualifiers are represented in AST
    - Update formatting logic to preserve colons in qualifier context
    - Add space after colon in qualifiers
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 3.2 Write property test for colon preservation
    - **Property 2: Colon Preservation**
    - **Validates: Requirements 2.1, 2.2, 2.3**

  - [ ] 3.3 Write unit tests for colon qualifier examples
    - Test `unab merp: _all` preserves colon with space
    - Test other commands with colon qualifiers
    - _Requirements: 2.1, 2.2, 2.3_

- [ ] 4. Fix varlist preservation and option comma spacing
  - [ ] 4.1 Update `printCommand()` to preserve varlists
    - Ensure varlist is emitted before options
    - Add space between command name and varlist
    - Add spaces between varlist items
    - _Requirements: 3.1, 3.2, 4.1, 4.2, 4.3_

  - [ ] 4.2 Fix comma spacing before options
    - Ensure `, ` (comma space) is used before options
    - Prevent newlines after commas
    - _Requirements: 3.3_

  - [ ] 4.3 Write property test for varlist preservation
    - **Property 3: Varlist Preservation**
    - **Validates: Requirements 3.1, 3.2, 4.1, 4.2, 4.3**

  - [ ] 4.4 Write property test for option comma spacing
    - **Property 4: Option Comma Spacing**
    - **Validates: Requirements 3.3**

  - [ ] 4.5 Write unit tests for varlist and option examples
    - Test `rename *, lower` preserves varlist and comma spacing
    - Test commands with multiple varlist items
    - Test commands with only options (no varlist)
    - _Requirements: 3.1, 3.2, 3.3, 4.1, 4.2, 4.3_

- [ ] 5. Checkpoint - Ensure all tests pass
  - Run all new tests and verify they pass
  - Run existing formatter tests to ensure no regressions
  - Ask the user if questions arise

- [ ] 6. Fix statement terminator control
  - [ ] 6.1 Update statement terminator logic
    - Add context tracking to prevent terminators within commands
    - Only emit terminators at end of complete statements
    - _Requirements: 6.1, 6.2, 6.3_

  - [ ] 6.2 Write property test for statement terminator placement
    - **Property 6: Statement Terminator Placement**
    - **Validates: Requirements 6.1, 6.2, 6.3**

  - [ ] 6.3 Write unit tests for statement terminator examples
    - Test no terminator after prefix colon
    - Test no terminator after comma before options
    - Test terminator only at end of complete command
    - _Requirements: 6.1, 6.2, 6.3_

- [ ] 7. Implement round-trip consistency validation
  - [ ] 7.1 Add round-trip test infrastructure
    - Create helper to format then parse and compare ASTs
    - Handle AST equivalence checking (ignore trivia differences)
    - _Requirements: 8.1, 8.2, 8.3_

  - [ ] 7.2 Write property test for round-trip consistency
    - **Property 8: Round-Trip Consistency**
    - **Validates: Requirements 8.1, 8.2, 8.3**

- [ ] 8. Handle edge cases
  - [ ] 8.1 Add edge case handling
    - Handle commands with no arguments (no trailing spaces)
    - Handle commands with only options (no varlist)
    - Handle empty varlists and option lists
    - _Requirements: 9.1, 9.2, 9.3_

  - [ ] 8.2 Write property test for edge case handling
    - **Property 9: Edge Case Handling**
    - **Validates: Requirements 9.1, 9.2, 9.3**

  - [ ] 8.3 Write unit tests for edge cases
    - Test command with no arguments
    - Test command with only options
    - Test empty varlists
    - _Requirements: 9.1, 9.2, 9.3_

- [ ] 9. Verify command structure recognition
  - [ ] 9.1 Review AST node structure handling
    - Verify prefix field detection works correctly
    - Verify colon detection in prefix commands
    - Verify option detection and comma handling
    - _Requirements: 10.1, 10.2, 10.3_

  - [ ] 9.2 Write property test for command structure recognition
    - **Property 10: Command Structure Recognition**
    - **Validates: Requirements 10.1, 10.2, 10.3**

- [ ] 10. Implement wildcard pattern preservation
  - [ ] 10.1 Update varlist formatting to preserve wildcard patterns
    - Ensure no space inserted between variable name and wildcard (`*`, `?`)
    - Maintain spaces between separate varlist items
    - Handle patterns like `var*`, `old?`, `_*`
    - _Requirements: 11.1, 11.2, 11.3_

  - [ ] 10.2 Write property test for wildcard pattern preservation
    - **Property 11: Wildcard Pattern Preservation**
    - **Validates: Requirements 11.1, 11.2, 11.3**

  - [ ] 10.3 Write unit tests for wildcard patterns
    - Test `rename var* new*` preserves patterns without internal spaces
    - Test `summarize var* other` has space between items
    - Test various wildcard patterns (`*`, `?`, combinations)
    - _Requirements: 11.1, 11.2, 11.3_

- [ ] 11. Final checkpoint - Ensure all tests pass
  - Run complete test suite
  - Verify no regressions in existing tests
  - Verify all new property tests pass with 100+ iterations
  - Ask the user if questions arise

## Notes

- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- All formatter tests must run against both AST formatter and source-preserving formatter using helpers from `tests/property/helpers/formatter-test-utils.ts`
