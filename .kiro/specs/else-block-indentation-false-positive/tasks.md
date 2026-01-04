# Implementation Plan: Else Block Indentation False Positive Fix

## Overview

This implementation fixes the parser to recognize macro references as command names, which will automatically resolve the indentation diagnostic and formatter issues.

## Tasks

- [x] 1. Add macro reference command parsing to the parser
  - [x] 1.1 Add parseMacroCommand method to StataParser
    - Create new method to parse commands starting with macro references
    - Handle MACRO_REF_LOCAL and MACRO_REF_GLOBAL tokens
    - Parse subsequent arguments until statement terminator
    - _Requirements: 1.1, 1.2, 1.4_

  - [x] 1.2 Update parseStatement to handle macro reference tokens
    - Add condition to check for MACRO_REF_LOCAL and MACRO_REF_GLOBAL
    - Call parseMacroCommand when macro reference is detected
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 1.3 Write unit tests for macro reference command parsing
    - Test local macro at start of statement
    - Test global macro at start of statement
    - Test macro command with various argument types
    - _Requirements: 1.1, 1.2, 1.4_

- [x] 2. Verify indentation diagnostic fix
  - [x] 2.1 Update reproduction test to verify fix
    - Modify tests/repro_else_indent.test.ts to expect passing tests
    - Verify else block body.length > 0 after parser fix
    - Verify expected_depths map has correct values
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 2.2 Write property test for indentation depth computation
    - **Property 3: Indentation depth computation for nested blocks**
    - **Validates: Requirements 2.1, 2.3, 2.4, 2.5, 2.6**

- [x] 3. Verify formatter fix
  - [x] 3.1 Add formatter test for else block with macro command
    - Test that formatter preserves correct indentation
    - Test nested structures with macro commands
    - _Requirements: 3.1, 3.2_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
