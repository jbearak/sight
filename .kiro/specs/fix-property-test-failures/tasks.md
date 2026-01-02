# Implementation Plan: Fix Property-Based Test Failures

## Overview

Implementation tasks to fix two failing property-based tests by improving syntax command option parsing and macro detection error handling.

## Tasks

- [x] 1. Create unit tests for syntax option parsing edge cases
  - Create `tests/unit/syntax-option-parsing.test.ts`
  - Write tests for duplicate option names with different required flags
  - Write tests for edge case option names like `O_`
  - Write tests for `isRequired` flag correctness
  - Write tests for diagnostic emission on duplicates
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 2. Create unit tests for macro detection edge cases
  - Create `tests/unit/macro-detection-edge-cases.test.ts`
  - Write tests for incomplete macro syntax: `'${` without closing `}`
  - Write tests for macro definitions after incomplete syntax
  - Write tests for recovery from malformed macro expressions
  - Write tests for symbol table registration after errors
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 3. Fix syntax command option parsing
  - [x] 3.1 Locate option deduplication logic in parser
    - Search for Map/Set-based deduplication in syntax command handler
    - Identify where options are being collapsed
    - _Requirements: 1.1_

  - [x] 3.2 Modify option parsing to preserve all options
    - Change deduplication logic to preserve all options
    - Ensure `isRequired` flag is correctly set from `*optname` syntax
    - Maintain option order as they appear in syntax
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 3.3 Add diagnostic emission for duplicate options
    - Emit warning when duplicate option names are encountered
    - Include option name in diagnostic message
    - _Requirements: 1.4_

  - [x] 3.4 Test syntax option parsing fixes
    - Run new unit tests from task 1
    - Verify all 533 existing tests still pass
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 4. Fix macro detection in lexer
  - [x] 4.1 Improve macro tokenization for incomplete syntax
    - Locate macro tokenization logic in lexer
    - Add handling for unclosed `${...}` expressions
    - Add recovery logic to continue after malformed macros
    - _Requirements: 2.1_

  - [x] 4.2 Maintain position accuracy after recovery
    - Ensure line and character positions are correctly updated
    - Verify subsequent tokens have correct positions
    - _Requirements: 2.5_

  - [x] 4.3 Emit diagnostics for incomplete macro syntax
    - Emit warning for incomplete macro expressions
    - Include recovery point in diagnostic
    - _Requirements: 2.1_

  - [x] 4.4 Test macro tokenization fixes
    - Run new unit tests from task 2
    - Verify position tracking is correct
    - _Requirements: 2.1, 2.5_

- [x] 5. Fix macro detection in analyzer
  - [x] 5.1 Ensure macro definitions are registered before errors
    - Review macro registration logic in analyzer
    - Ensure macros are captured before incomplete syntax is encountered
    - _Requirements: 2.2, 2.3_

  - [x] 5.2 Add recovery logic for malformed macro expressions
    - Add error recovery to continue processing after incomplete syntax
    - Ensure subsequent macro definitions are still registered
    - _Requirements: 2.2, 2.3_

  - [x] 5.3 Verify symbol table registration
    - Test that all macros appear in symbol table
    - Test that document symbols include all macros
    - _Requirements: 2.4_

  - [x] 5.4 Test macro detection fixes
    - Run new unit tests from task 2
    - Verify all macros appear in document symbols
    - _Requirements: 2.2, 2.3, 2.4_

- [x] 6. Fix property-based test: Syntax command options
  - [x] 6.1 Run failing test with fixes
    - Execute: `bun test -- syntax-command-parsing.prop.test.ts`
    - Verify test "should differentiate required vs optional options" passes
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 6.2 Verify no regressions in syntax parsing tests
    - Run all syntax command parsing tests
    - Verify all pass
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 7. Fix property-based test: Symbol completeness
  - [x] 7.1 Run failing test with fixes
    - Execute: `bun test -- symbol-completeness.prop.test.ts`
    - Verify test "should include all macros in document symbols" passes
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 7.2 Verify no regressions in symbol tests
    - Run all symbol completeness tests
    - Verify all pass
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 8. Checkpoint - Verify all tests pass
  - Run full test suite: `bun test`
  - Verify 535 tests pass (533 existing + 2 fixed)
  - Verify no regressions
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 9. Final verification
  - [x] 9.1 Run property-based tests multiple times
    - Execute: `bun test` (multiple runs to verify stability)
    - Verify both previously failing tests consistently pass
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 9.2 Verify performance
    - Ensure no performance regression in parsing or analysis
    - Check that test execution time is reasonable
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5_

## Notes

- Tasks 1-2 create unit tests that will help identify and verify fixes
- Tasks 3-5 implement the actual fixes in parser, lexer, and analyzer
- Tasks 6-7 verify the property-based tests now pass
- Task 8 is a checkpoint to ensure no regressions
- Task 9 provides final verification and performance checks

## Dependencies

- Task 1 and 2 can be done in parallel
- Tasks 3 and 4 can be done in parallel
- Task 5 depends on task 4 (lexer fixes)
- Tasks 6 and 7 depend on tasks 3-5
- Task 8 depends on tasks 6-7
- Task 9 depends on task 8
