# Implementation Plan: Stata System-Defined Global Macros

## Overview

This implementation adds recognition of Stata system-defined global macros to the analyzer, preventing false positive "undefined global macro" warnings for macros like `$S_DATE`, `$S_TIME`, `$S_FNDATE`, etc.

## Tasks

- [ ] 1. Add system globals constant and helper function
  - [ ] 1.1 Add `STATA_SYSTEM_GLOBALS` constant set to `src/analyzer/index.ts`
    - Define Set<string> with all known system global macro names
    - Add documentation comments explaining each macro
    - Export the constant for use by other components
    - _Requirements: 1.1, 4.1, 4.2_
  
  - [ ] 1.2 Add `is_system_global` helper method to `SemanticAnalyzer` class
    - Add private method that checks if name is in STATA_SYSTEM_GLOBALS
    - Place near `is_positional_argument` for logical grouping
    - _Requirements: 4.3_

- [ ] 2. Integrate system global check into is_macro_defined
  - [ ] 2.1 Modify `is_macro_defined` to check system globals as fallback
    - Add system global check at end of global scope branch
    - Return true if `is_system_global(name)` returns true
    - Ensure check happens after symbol table and directive checks
    - _Requirements: 1.2, 2.1_

- [ ] 3. Checkpoint - Verify basic functionality
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Add property-based tests
  - [ ] 4.1 Write property test for system globals not flagged
    - **Property 1: System Globals Never Flagged as Undefined**
    - Generate code with random system global references
    - Verify no undefined global macro diagnostics produced
    - **Validates: Requirements 1.1, 1.2**
  
  - [ ] 4.2 Write property test for case-sensitive matching
    - **Property 2: Case-Sensitive System Global Matching**
    - Generate lowercase variants of system globals
    - Verify undefined global macro diagnostics ARE produced
    - **Validates: Requirements 1.3**
  
  - [ ] 4.3 Write property test for non-system globals still flagged
    - **Property 3: Non-System Globals Still Flagged**
    - Generate random non-system global macro names
    - Verify undefined global macro diagnostics produced
    - **Validates: Requirements 2.1, 2.2**
  
  - [ ] 4.4 Write property test for is_system_global function
    - **Property 4: System Global Set Completeness**
    - Test is_system_global returns true for all set members
    - Test is_system_global returns false for non-members
    - **Validates: Requirements 4.1**

- [ ] 5. Add unit tests
  - [ ] 5.1 Write unit tests for all system globals
    - Test each macro in STATA_SYSTEM_GLOBALS individually
    - Verify no undefined warning for each
    - _Requirements: 1.1_
  
  - [ ] 5.2 Write unit tests for edge cases
    - Test case sensitivity (lowercase variants flagged)
    - Test similar names not in set (e.g., $S_CUSTOM)
    - Test integration with user-defined globals
    - _Requirements: 1.3, 2.2_

- [ ] 6. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required for comprehensive coverage
- The implementation follows the existing pattern used for `is_positional_argument`
- System global check is a fallback (last check) for efficiency
- All macro names are case-sensitive per Stata conventions
