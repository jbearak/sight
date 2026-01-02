# Implementation Plan: Extended Missing Value Tokenization

## Overview

This implementation fixes the false positive "split literal" diagnostics for extended missing values by updating the lexer to recognize `.a` through `.z` as single NUMBER tokens.

## Tasks

- [x] 1. Implement extended missing value tokenization in lexer
  - [x] 1.1 Add `scanExtendedMissingOrWord()` method to lexer
    - Add new private method to handle dot followed by letter(s)
    - Handle three cases:
      1. Lowercase single letter (`.a`-`.z`) → NUMBER token (valid extended missing)
      2. Uppercase single letter (`.A`-`.Z`) → WORD token (invalid)
      3. Multiple letters (`.ab`, `.abc`, `.Abc`) → single WORD token (invalid)
    - _Requirements: 1.1, 1.2, 1.5_

  - [x] 1.2 Update `scanToken()` to call new method
    - Add check for dot followed by letter before the fallthrough case
    - Ensure decimal numbers (`.5`) still work correctly
    - _Requirements: 1.4_

  - [x] 1.3 Write property test for extended missing value tokenization
    - **Property 1: Extended Missing Value Tokenization (Lowercase)**
    - Test that `.a` through `.z` produce NUMBER tokens
    - **Validates: Requirements 1.1**

  - [x] 1.4 Write property test for uppercase dot-letter sequences
    - **Property 2: Uppercase Dot-Letter Sequences Produce WORD Tokens**
    - Test that `.A` through `.Z` produce WORD tokens (not NUMBER)
    - **Validates: Requirements 1.2**

  - [x] 1.5 Write property test for multi-letter sequences
    - **Property 5: Multi-Letter Dot Sequences Tokenization**
    - Test that `.ab`, `.abc`, `.Abc` produce single WORD tokens
    - **Validates: Requirements 1.5**

- [x] 2. Verify split literal detection behavior
  - [x] 2.1 Verify no false positives for extended missing values
    - Test that `.a` in `if x == .a` produces no warnings
    - Test that `.z` in expressions produces no warnings
    - _Requirements: 2.2, 3.1, 3.2_

  - [x] 2.2 Write property test for no false positive split literal
    - **Property 6: No False Positive Split Literal for Extended Missing Values**
    - **Validates: Requirements 2.2, 3.1, 3.2**

  - [x] 2.3 Verify split literal detection still works for actual splits
    - Test that `. a` (with whitespace) still produces warning
    - Test that `. 5` (with whitespace) still produces warning
    - _Requirements: 2.1, 2.3_

  - [x] 2.4 Write property test for whitespace separation
    - **Property 3: Whitespace Prevents Extended Missing Value Tokenization**
    - **Validates: Requirements 1.3**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Verify backward compatibility
  - [x] 4.1 Verify system missing value behavior
    - Test that standalone `.` is still tokenized as WORD
    - _Requirements: 3.3_

  - [x] 4.2 Verify decimal number behavior
    - Test that `.5`, `3.14` are still tokenized as NUMBER
    - _Requirements: 3.4_

  - [x] 4.3 Write property test for decimal number preservation
    - **Property 4: Decimal Number Tokenization Preserved**
    - **Validates: Requirements 1.4**

- [x] 5. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
