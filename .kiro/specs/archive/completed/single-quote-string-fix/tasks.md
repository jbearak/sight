# Implementation Plan: Single Quote String Fix

## Overview

This implementation removes the incorrect single-quote string tokenization from the Stata lexer. The fix is straightforward: remove the `scanSingleQuotedString` method and treat standalone apostrophes as operators.

## Tasks

- [x] 1. Remove single-quote string tokenization from lexer
  - [x] 1.1 Modify `scanToken()` to treat apostrophe as OPERATOR
    - In `src/lexer/index.ts`, find the block handling `char === "'"` 
    - Replace `return this.scanSingleQuotedString(startLine, startColumn)` with `return this.makeToken('OPERATOR', char, startLine, startColumn)`
    - _Requirements: 1.1, 1.2, 3.2_
  - [x] 1.2 Modify `scanEmbeddedContent()` to treat apostrophe as OPERATOR
    - In `src/lexer/index.ts`, find the embedded content block handling `first_char === "'"`
    - Replace `return this.scanSingleQuotedString(startLine, startColumn)` with `return this.makeToken('OPERATOR', first_char, startLine, startColumn)`
    - _Requirements: 1.1, 3.2_
  - [x] 1.3 Remove the `scanSingleQuotedString()` method
    - Delete the entire `scanSingleQuotedString` method from `src/lexer/index.ts`
    - _Requirements: 1.1_

- [x] 2. Verify existing functionality is preserved
  - [x] 2.1 Run existing lexer tests to ensure no regressions
    - Execute `bun test tests/unit/lexer.test.ts`
    - Fix any failing tests that incorrectly expected single-quote strings
    - _Requirements: 2.1, 2.2, 2.3_

- [x] 3. Add unit tests for the fix
  - [x] 3.1 Add unit tests for standalone apostrophe tokenization
    - Create tests verifying `'word'` produces OPERATOR, WORD, OPERATOR tokens
    - Create tests verifying standalone `'` produces OPERATOR token
    - _Requirements: 1.1, 1.2, 3.2_
  - [x] 3.2 Add unit tests for preserved macro reference behavior
    - Verify `` `name' `` still produces MACRO_REF_LOCAL
    - Verify `` `' `` (empty) still produces MACRO_REF_LOCAL
    - _Requirements: 1.3, 1.4, 3.1_
  - [x] 3.3 Add unit tests for apostrophes inside strings
    - Verify `"it's"` includes apostrophe in STRING value
    - Verify `` `"it's"' `` includes apostrophe in STRING value
    - _Requirements: 3.3, 3.4_

- [x] 4. Add property-based tests
  - [x] 4.1 Write property test for standalone apostrophe tokenization
    - **Property 1: Standalone Apostrophe Tokenization**
    - **Validates: Requirements 1.1, 1.2, 3.2**
  - [x] 4.2 Write property test for local macro reference preservation
    - **Property 2: Local Macro Reference Preservation**
    - **Validates: Requirements 1.4, 3.1**
  - [x] 4.3 Write property test for string literal round-trip
    - **Property 3: Valid String Literal Round-Trip**
    - **Validates: Requirements 2.1, 2.2, 2.3, 3.3, 3.4**
  - [x] 4.4 Write property test for no false unclosed string errors
    - **Property 4: No False Unclosed String Errors**
    - **Validates: Requirements 3.5**

- [x] 5. Checkpoint - Ensure all tests pass
  - Run full test suite: `bun test`
  - All single-quote related tests pass. 6 pre-existing failures unrelated to this fix.

## Notes

- The fix is localized to `src/lexer/index.ts` only
- No parser or analyzer changes are needed
- Existing macro reference behavior must be preserved
