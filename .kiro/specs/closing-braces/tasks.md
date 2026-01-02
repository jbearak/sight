# Implementation Plan: Orphan Closing Brace Detection

## Overview

This implementation adds detection for orphan closing braces (closing braces without matching opening braces) in the Stata parser. The fix is localized to the `parseStatement()` method and requires adding a new error code.

## Tasks

- [ ] 1. Add new error code for orphan closing braces
  - Add `ORPHAN_CLOSE_BRACE = 3012` to `ParseErrorCode` enum in `src/types/index.ts`
  - _Requirements: 2.1, 2.2_

- [ ] 2. Implement orphan closing brace detection in parser
  - [ ] 2.1 Add RBRACE handling in parseStatement()
    - Add explicit check for RBRACE token before the `else` fallback branch
    - Emit error diagnostic with message "unexpected closing brace - no matching opening brace"
    - Use `ParseErrorCode.ORPHAN_CLOSE_BRACE` as the error code
    - Preserve leading trivia and return null after emitting error
    - _Requirements: 1.1, 2.1, 2.2, 2.3_

  - [ ] 2.2 Write property test for orphan brace detection
    - **Property 1: Orphan Closing Brace Detection**
    - Generate random Stata code without blocks, insert `}` at top level
    - Verify parser emits diagnostic with code `ORPHAN_CLOSE_BRACE`
    - Verify diagnostic range matches brace token position
    - **Validates: Requirements 1.1, 2.1, 2.2, 2.3**

- [ ] 3. Verify valid block structures don't produce false positives
  - [ ] 3.1 Write property test for valid block acceptance
    - **Property 2: Valid Block Structure Acceptance**
    - Generate valid if/else/foreach/forvalues/while/frame/prefix blocks
    - Verify no `ORPHAN_CLOSE_BRACE` diagnostic is emitted
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8**

- [ ] 4. Verify multiple orphan braces are handled correctly
  - [ ] 4.1 Write property test for multiple orphan braces
    - **Property 3: Multiple Orphan Brace Handling**
    - Generate documents with N orphan braces on different lines
    - Verify exactly N diagnostics are emitted
    - Verify each diagnostic has correct line number
    - **Validates: Requirements 3.1, 3.2**

- [ ] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Verify exclusion cases (macro, embedded, string)
  - [ ] 6.1 Write property test for macro brace exclusion
    - **Property 4: Macro Brace Exclusion**
    - Generate documents with `${name}` macro references
    - Verify no `ORPHAN_CLOSE_BRACE` diagnostic is emitted
    - **Validates: Requirements 4.1, 4.2**

  - [ ] 6.2 Write property test for embedded language exclusion
    - **Property 5: Embedded Language Exclusion**
    - Generate documents with Mata/Python blocks containing braces
    - Verify no `ORPHAN_CLOSE_BRACE` diagnostic is emitted
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**

  - [ ] 6.3 Write property test for string literal exclusion
    - **Property 6: String Literal Exclusion**
    - Generate documents with strings containing `}` characters
    - Verify no `ORPHAN_CLOSE_BRACE` diagnostic is emitted
    - **Validates: Requirements 6.1, 6.2, 6.3**

- [ ] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- Properties 4-6 verify existing lexer behavior (braces in macros/strings/embedded blocks are not tokenized as RBRACE)
- The core implementation is in tasks 1 and 2.1
