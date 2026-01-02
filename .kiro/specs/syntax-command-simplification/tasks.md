# Implementation Plan: Syntax Command Simplification

## Overview

This implementation removes the buggy syntax command diagnostic feature to reach an MVP faster. The changes are minimal: remove diagnostic emissions from the parser and analyzer while preserving option extraction for completions.

## Tasks

- [ ] 1. Remove parser diagnostics for syntax commands
  - [ ] 1.1 Remove "outside program" warning from parseSyntaxCommand()
    - Locate and remove the `addError()` call for "syntax command should only appear inside program define"
    - _Requirements: 1.1_

  - [ ] 1.2 Remove "unknown argument type" diagnostic
    - Locate and remove the `addError()` call for "Unknown argument type: X"
    - _Requirements: 1.2_

  - [ ] 1.3 Remove "duplicate option" diagnostics
    - Locate and remove both `addError()` calls for "Duplicate option: X"
    - _Requirements: 1.3_

- [ ] 2. Remove analyzer validation for syntax commands
  - [ ] 2.1 Remove validation method calls from analyze_syntax_node()
    - Remove calls to `validate_argument_type()` and `validate_option_argument_type()`
    - Keep `register_implicit_locals()` call intact
    - _Requirements: 3.1, 3.2_

- [ ] 3. Checkpoint - Verify no syntax command diagnostics
  - Run existing tests to ensure no regressions
  - Verify option extraction still works
  - Ensure all tests pass, ask the user if questions arise

- [ ] 4. Write property test for no syntax command diagnostics
  - **Property 1: No Syntax Command Diagnostics**
  - **Validates: Requirements 1.1, 1.2, 1.3, 1.4**

- [ ] 5. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise

## Notes

- The implementation is surgical: only remove diagnostic emissions, preserve all other functionality
- Option extraction and implicit local registration must continue to work
