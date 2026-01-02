# Implementation Plan: Macro Completion with Closing Quote

## Overview

This implementation plan addresses the gap between the current macro completion behavior and the design requirements. The current implementation uses simple `insertText` for completions, but the design requires range-based `textEdit` to properly handle cursor positions within existing macro references and avoid duplicating closing delimiters.

## Tasks

- [x] 1. Enhance context detection for cursor position boundaries
  - [x] 1.1 Update `detect_macro_context` to handle cursor inside existing macro references
    - Detect local macro context when cursor is strictly between backtick and closing apostrophe
    - Return null (no context) when cursor is after closing apostrophe (e.g., `` `name'| ``)
    - Detect global braced context when cursor is between `${` and `}` (if present)
    - Detect global unbraced context when cursor is after `$` within identifier chars
    - Return null when cursor is after closing `}` (e.g., `${name}|`)
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4_

  - [x] 1.2 Write property test for local macro context detection boundary
    - **Property 1: Local Macro Context Detection Boundary**
    - **Validates: Requirements 1.1, 1.3**

  - [x] 1.3 Write property test for global macro context detection boundary
    - **Property 2: Global Macro Context Detection Boundary**
    - **Validates: Requirements 2.1, 2.2, 2.4**

- [x] 2. Implement comment context exclusion
  - [x] 2.1 Add comment detection to macro context detection
    - Check if cursor position is inside a comment (line comment `//`, `*`, or block comment `/* */`)
    - Return null (no macro context) when inside comments
    - Use existing lexer/trivia/context tracker for best-effort detection in embedded Mata/Python blocks
    - _Requirements: 3.1, 3.2_

  - [x] 2.2 Write property test for comment context exclusion
    - **Property 10: Comment Context Exclusion**
    - **Validates: Requirements 3.1, 3.2**

- [x] 3. Implement replacement range computation for macro completions
  - [x] 3.1 Add `compute_macro_replacement_range` function
    - Compute maximal contiguous span of `Macro_Identifier_Char` (`[A-Za-z0-9_]`) surrounding cursor
    - Stop at first non-identifier character (whitespace, `.`, etc.) even if closing delimiter exists later
    - For unbraced global (`$apple.sauce`): invalid char terminates macro name, suffix is plain text (not replaced)
    - For local (`` `apple.sauce' ``) and braced global (`${apple.sauce}`): invalid char terminates macro name, but whole reference is a diagnostic error
    - _Requirements: 4.1, 4.3, 5.1, 5.2, 5.4, 5.5_

  - [x] 3.2 Write property test for replacement range stops at non-identifier characters
    - **Property 3: Replacement Range Stops at Non-Identifier Characters**
    - **Validates: Requirements 4.1, 4.3, 5.1, 5.4**

  - [x] 3.3 Write property test for unbraced global terminates at first non-identifier
    - **Property 4: Unbraced Global Terminates at First Non-Identifier**
    - **Validates: Requirements 5.4**

- [x] 4. Update prefix derivation to use replacement range
  - [x] 4.1 Refactor `get_macro_prefix` to derive prefix from replacement range
    - Prefix = exact text contained in computed replacement range
    - Empty string if replacement range is empty
    - _Requirements: 4.2, 5.3_

  - [x] 4.2 Write property test for prefix derivation matches replacement range
    - **Property 5: Prefix Derivation Matches Replacement Range**
    - **Validates: Requirements 4.2, 5.3**

- [x] 5. Checkpoint - Ensure all tests pass
  - Run `bun test` and ensure all tests pass
  - Ask the user if questions arise

- [x] 6. Verify filtering and kind-specific completion lists
  - [x] 6.1 Verify prefix filtering works correctly with new implementation
    - Case-insensitive prefix matching
    - Empty prefix returns all macros of relevant kind
    - No matches returns empty list
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 6.2 Write property test for prefix filtering
    - **Property 6: Prefix Filtering**
    - **Validates: Requirements 6.1**

  - [x] 6.3 Write property test for kind-specific completion lists
    - **Property 7: Kind-Specific Completion Lists**
    - **Validates: Requirements 6.2**

- [x] 7. Implement suffix handling based on existing delimiters
  - [x] 7.1 Add logic to detect existing closing delimiter after replacement range
    - For local macros: check if apostrophe `'` exists immediately after replacement range end
    - For global braced macros: check if `}` exists immediately after replacement range end
    - _Requirements: 7.2, 7.3, 7.6, 7.7_

  - [x] 7.2 Update `get_macro_completions` to use `textEdit` with computed range
    - Replace `insertText` with `textEdit: { range, newText }`
    - Append closing apostrophe only if not already present (local macros)
    - Append closing brace only if not already present (global braced macros)
    - Do not append suffix for global unbraced macros
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [x] 7.3 Write property test for local macro suffix handling
    - **Property 8: Local Macro Suffix Handling**
    - **Validates: Requirements 7.2, 7.3**

  - [x] 7.4 Write property test for global macro brace suffix handling
    - **Property 9: Global Macro Brace Suffix Handling**
    - **Validates: Requirements 7.6, 7.7**

- [x] 8. Verify trigger character behavior
  - [x] 8.1 Ensure backtick trigger returns local macro completions outside comments
    - Verify existing trigger character handling works correctly
    - Add comment exclusion check to trigger handling
    - _Requirements: 1.7_

  - [x] 8.2 Ensure dollar sign trigger returns global macro completions
    - Verify existing trigger character handling works correctly
    - _Requirements: 2.5_

  - [x] 8.3 Write property test for trigger character behavior
    - **Property 11: Trigger Character Behavior**
    - **Validates: Requirements 1.7, 2.5**

- [x] 9. Add diagnostics for invalid characters in macro names
  - [x] 9.1 Add diagnostic for invalid char in local macro reference
    - Detect non-`Macro_Identifier_Char` between backtick and closing apostrophe
    - Report error covering full macro reference span (from `` ` `` to `'`)
    - Message: "invalid character in macro name"
    - _Requirements: 4.3_

  - [x] 9.2 Add diagnostic for invalid char in braced global macro reference
    - Detect non-`Macro_Identifier_Char` between `${` and `}`
    - Report error covering full macro reference span (from `${` to `}`)
    - Message: "invalid character in macro name"
    - _Requirements: 5.5_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Run `bun test` and ensure all tests pass
  - Ask the user if questions arise

## Notes

- All tasks are required for comprehensive implementation
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation via `bun test`
- Property tests validate universal correctness properties (numbered to match design.md)
- The implementation builds incrementally: context detection → comment exclusion → replacement range → prefix derivation → filtering → suffix handling → triggers → diagnostics
