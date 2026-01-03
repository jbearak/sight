# Implementation Plan: Dual Formatter Testing

## Overview

This implementation creates test infrastructure for running formatter tests against both formatter implementations, then migrates existing tests to use the new infrastructure and documents the approach in AGENTS.md.

## Tasks

- [x] 1. Create formatter test utilities
  - [x] 1.1 Create `tests/property/helpers/formatter-test-utils.ts` with type definitions and helper functions
    - Define `FormatterMode` type and `FORMATTER_MODES` constant
    - Implement `create_formatter_config()` function
    - Implement `for_each_formatter_mode()` for unit tests
    - Implement `for_each_formatter_mode_property()` for property tests
    - Implement `skip_for_mode()` and `mode_specific_assertion()` helpers
    - _Requirements: 2.1, 2.2, 2.3, 4.1, 4.2_

  - [x] 1.2 Write property test for config mode correctness
    - **Property 2: Config Mode Correctness**
    - **Validates: Requirements 2.2**

  - [x] 1.3 Write property test for mode skip correctness
    - **Property 3: Mode Skip Correctness**
    - **Validates: Requirements 4.1, 4.2**

  - [x] 1.4 Write property test for test name mode inclusion
    - **Property 4: Test Name Mode Inclusion**
    - **Validates: Requirements 5.2**

- [x] 2. Checkpoint - Ensure helper utilities work correctly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Migrate existing formatter tests to dual-mode execution
  - [x] 3.1 Migrate `formatter-indentation.prop.test.ts` to use dual-mode helpers
    - Import formatter test utilities
    - Wrap tests with `for_each_formatter_mode()` or `for_each_formatter_mode_property()`
    - Add mode-specific assertions where needed
    - _Requirements: 3.1, 3.2_

  - [x] 3.2 Migrate `formatter-source-preservation.prop.test.ts` to use dual-mode helpers
    - Import formatter test utilities
    - Wrap tests with `for_each_formatter_mode()` or `for_each_formatter_mode_property()`
    - Add mode-specific assertions where needed
    - _Requirements: 3.1, 3.2_

  - [x] 3.3 Migrate `formatter-comment-preservation.prop.test.ts` to use dual-mode helpers
    - Import formatter test utilities
    - Wrap tests with `for_each_formatter_mode()` or `for_each_formatter_mode_property()`
    - Add mode-specific assertions where needed
    - _Requirements: 3.1, 3.2_

  - [x] 3.4 Migrate `formatter-comment-normalization.prop.test.ts` to use dual-mode helpers
    - Import formatter test utilities
    - Wrap tests with `for_each_formatter_mode()` or `for_each_formatter_mode_property()`
    - Add mode-specific assertions where needed
    - _Requirements: 3.1, 3.2_

  - [x] 3.5 Migrate `formatter-embedded-context.prop.test.ts` to use dual-mode helpers
    - Import formatter test utilities
    - Wrap tests with `for_each_formatter_mode()` or `for_each_formatter_mode_property()`
    - Add mode-specific assertions where needed
    - _Requirements: 3.1, 3.2_

  - [x] 3.6 Migrate `formatting-preservation.prop.test.ts` to use dual-mode helpers
    - Import formatter test utilities
    - Wrap tests with `for_each_formatter_mode()` or `for_each_formatter_mode_property()`
    - Add mode-specific assertions where needed
    - _Requirements: 3.1, 3.2_

  - [x] 3.7 Update `formatter-mode.prop.test.ts` to exclude mode-specific tests from dual execution
    - Review tests that specifically test mode selection behavior
    - Keep mode-specific tests as single-mode tests
    - Migrate general formatter behavior tests to dual-mode
    - _Requirements: 3.3_

- [x] 4. Checkpoint - Ensure all migrated tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Update AGENTS.md documentation
  - [x] 5.1 Add dual-formatter documentation to AGENTS.md
    - Add section under "Formatting and Analysis" explaining the two formatters
    - Document the requirement to use dual-mode test helpers for new formatter tests
    - Reference the location of test helper utilities
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 6. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- The `formatter-mode.prop.test.ts` file contains mode-specific tests that should NOT be wrapped in dual-mode execution (Requirement 3.3)
