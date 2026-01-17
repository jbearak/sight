# Implementation Plan: Macro Reference Variable Registration Bug Fix

## Overview

This implementation fixes a bug where macro references are incorrectly registered as variables. The fix adds a helper function `is_macro_reference()` and guard checks to all five affected variable extraction functions in the analyzer.

## Tasks

- [ ] 1. Add is_macro_reference helper function
  - Add private method `is_macro_reference(name: string): boolean` to SemanticAnalyzer class
  - Return true for local macro references (starts with backtick, ends with single quote)
  - Return true for global macro references (starts with `$`)
  - Return false for plain identifiers
  - _Requirements: 3.1, 3.2, 3.3_

- [ ] 2. Fix extract_confirm_variable function
  - [ ] 2.1 Add macro reference guard check
    - Add `if (this.is_macro_reference(var_node.name)) { return; }` before creating VariableSymbol
    - _Requirements: 1.1, 2.1_
  - [ ] 2.2 Write unit test for confirm variable with macro reference
    - Test that `confirm variable \`my_var'` does not register a variable
    - Test that `confirm variable $my_var` does not register a variable
    - _Requirements: 1.1, 2.1_

- [ ] 3. Fix extract_gen_variable function
  - [ ] 3.1 Add macro reference guard check
    - Add `if (this.is_macro_reference(first_var.name)) { return; }` before creating VariableSymbol
    - _Requirements: 1.2, 2.2_
  - [ ] 3.2 Write unit test for gen with macro reference
    - Test that `gen \`my_var' = 1` does not register a variable
    - Test that `gen $my_var = 1` does not register a variable
    - _Requirements: 1.2, 2.2_

- [ ] 4. Fix extract_egen_variable function
  - [ ] 4.1 Add macro reference guard check
    - Add `if (this.is_macro_reference(first_var.name)) { return; }` before creating VariableSymbol
    - _Requirements: 1.3, 2.3_
  - [ ] 4.2 Write unit test for egen with macro reference
    - Test that `egen \`my_var' = mean(x)` does not register a variable
    - Test that `egen $my_var = mean(x)` does not register a variable
    - _Requirements: 1.3, 2.3_

- [ ] 5. Fix extract_input_variables function
  - [ ] 5.1 Add macro reference guard check inside loop
    - Add `if (this.is_macro_reference(var_node.name)) { continue; }` before creating VariableSymbol
    - _Requirements: 1.4, 2.4_
  - [ ] 5.2 Write unit test for input with macro reference
    - Test that `input \`my_var'` does not register a variable
    - Test that `input $my_var` does not register a variable
    - _Requirements: 1.4, 2.4_

- [ ] 6. Fix extract_rename_variables function
  - [ ] 6.1 Add macro reference guard check in simple syntax case
    - Add `if (this.is_macro_reference(new_var.name)) { return; }` before creating VariableSymbol
    - _Requirements: 1.5, 2.5_
  - [ ] 6.2 Add macro reference guard check in extract_grouped_rename_variables
    - Add `if (this.is_macro_reference(my_name)) { continue; }` inside the loop
    - _Requirements: 1.5, 2.5_
  - [ ] 6.3 Write unit test for rename with macro reference
    - Test that `rename old \`my_var'` does not register a variable
    - Test that `rename old $my_var` does not register a variable
    - _Requirements: 1.5, 2.5_

- [ ] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Write property test for macro references not registered
  - **Property 1: Macro references not registered as variables**
  - Generate random local and global macro references
  - Generate random variable-extracting commands with macro refs
  - Verify no VariableSymbol is registered for macro references
  - **Validates: Requirements 1.1-1.5, 2.1-2.5**

- [ ] 9. Write property test for is_macro_reference function
  - **Property 2: is_macro_reference correctly identifies macro references**
  - Generate random local macro references (`` `name' ``)
  - Generate random global macro references (`$name`, `${name}`)
  - Generate random valid identifiers
  - Verify function returns correct boolean for each
  - **Validates: Requirements 3.1, 3.2, 3.3**

- [ ] 10. Write property test for valid identifiers still registered
  - **Property 3: Valid identifiers still registered as variables**
  - Generate random valid Stata identifiers
  - Generate random variable-extracting commands with valid identifiers
  - Verify VariableSymbol is registered with correct source
  - **Validates: Requirements 4.1, 4.2**

- [ ] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- The `is_macro_reference` helper function should be placed near other helper methods in the analyzer class
