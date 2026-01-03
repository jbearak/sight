# Implementation Plan: Flaky Property Test Fixes

## Overview

This implementation plan addresses the flaky `formatting-preservation.prop.test.ts` test by modifying the `arbitrary_trailing_comment()` generator to not produce trailing whitespace in comments.

## Tasks

- [x] 1. Fix the trailing comment generator
  - [x] 1.1 Modify `arbitrary_trailing_comment()` to trim trailing whitespace
    - Update `tests/property/generators/primitives.ts`
    - Add `.trimEnd()` to the generated text before combining with comment delimiters
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. Verify the fix
  - [x] 2.1 Run the formatting preservation test multiple times
    - Execute `bun test tests/property/formatting-preservation.prop.test.ts` at least 5 times
    - Verify all tests pass consistently
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 3. Confirm other tests remain stable
  - [x] 3.1 Verify valid-block-terminators tests pass
    - Execute `bun test tests/property/valid-block-terminators.prop.test.ts`
    - Confirm all tests pass
    - _Requirements: 3.1_
  - [x] 3.2 Verify orphan-closing-brace tests pass
    - Execute `bun test tests/property/orphan-closing-brace.prop.test.ts`
    - Confirm all tests pass
    - _Requirements: 3.2_

- [x] 4. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- The fix is minimal: a single `.trimEnd()` call in the generator
- No changes are needed to the actual test logic or the formatter
- The other mentioned tests (valid-block-terminators, orphan-closing-brace) are already stable
