# Implementation Plan: Stata Outline Improvements

## Overview

This implementation plan extends the existing section detector (`src/providers/section-detector.ts`) to support block comment headings, banner section nesting levels, and improved false positive filtering. The implementation follows a phased approach, adding new detection capabilities while maintaining backward compatibility and O(N) performance.

## Tasks

- [x] 1. Implement helper functions for delimiter detection and validation
  - [x] 1.1 Implement `is_asterisk_delimiter()` function
    - Create function to detect lines with 4+ asterisks and optional whitespace
    - Handle both pure asterisk lines and comment-prefixed asterisk lines
    - Return boolean indicating if line is a valid asterisk delimiter
    - _Requirements: 1.2, 1.3_
  
  - [x] 1.2 Write property test for asterisk delimiter validation
    - **Property 2: Asterisk Delimiter Validation**
    - **Validates: Requirements 1.2, 1.3**
  
  - [x] 1.3 Implement `is_standalone_heading()` function
    - Create function to check if a line has minimal indentation (< 4 spaces, no tabs)
    - Calculate leading whitespace count
    - Return false for lines with 4+ spaces or starting with tab
    - Return true for lines at column 0 or with 1-3 spaces indentation
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  
  - [x] 1.4 Write property test for pure heading line validation
    - **Property 6: Pure Heading Line Validation**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
  
  - [x] 1.5 Implement `count_delimiter_chars()` function
    - Create function to count delimiter characters in a line
    - Handle pure delimiter lines (count all characters)
    - Handle comment-prefixed delimiters (count repeated chars after prefix)
    - Accept `DelimiterKind` parameter to identify delimiter type
    - Return integer count of delimiter characters
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  
  - [x] 1.6 Write property test for delimiter character counting
    - **Property 4: Banner Section Level Derivation**
    - **Validates: Requirements 2.4**

- [x] 2. Implement block comment heading detector
  - [x] 2.1 Create block comment detection logic in `detect_banner_sections()`
    - Add loop to scan for three-line block comment patterns
    - Check if line i-1 is asterisk delimiter using `is_asterisk_delimiter()`
    - Check if line i+1 is asterisk delimiter using `is_asterisk_delimiter()`
    - Extract heading text from line i when both checks pass
    - Strip leading/trailing asterisks and whitespace from heading text
    - Validate heading text is non-empty and not delimiter-only
    - Create `RawSection` with extracted name and line numbers
    - Mark lines i-1, i, and i+1 as consumed
    - _Requirements: 1.1, 1.4, 1.5_
  
  - [x] 2.2 Write property test for block comment heading detection
    - **Property 1: Block Comment Heading Detection**
    - **Validates: Requirements 1.1, 1.4**
  
  - [x] 2.3 Write property test for block comment line consumption
    - **Property 3: Block Comment Line Consumption**
    - **Validates: Requirements 1.5**
  
  - [x] 2.4 Write unit tests for block comment edge cases
    - Test block comment at start of file (line 0)
    - Test block comment at end of file
    - Test empty heading text after stripping
    - Test heading text that is all delimiters
    - Test mismatched delimiters (asterisks vs dashes)
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 3. Implement banner section nesting level calculation
  - [x] 3.1 Add level calculation to banner section detection
    - Call `count_delimiter_chars()` for top delimiter line
    - Call `count_delimiter_chars()` for bottom delimiter line
    - Calculate level from delimiter count using formula:
      - 4 chars → level 1
      - 5-7 chars → level 2
      - 8-11 chars → level 3
      - 12+ chars → level 4
    - Use minimum count when top and bottom differ
    - Assign calculated level to `RawSection`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  
  - [x] 3.2 Write property test for minimum level with mismatched delimiters
    - **Property 5: Minimum Level for Mismatched Delimiters**
    - **Validates: Requirements 2.5**
  
  - [x] 3.3 Write unit tests for level calculation edge cases
    - Test single-character delimiter counts (should map to level 1)
    - Test very large delimiter counts (20+ characters)
    - Test matching delimiter counts at each level threshold
    - Test mismatched delimiter counts (verify minimum is used)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 4. Add indentation filtering to numbered section detection
  - [x] 4.1 Integrate `is_standalone_heading()` into `detect_numbered_sections()`
    - Call `is_standalone_heading()` before creating section
    - Skip section creation if function returns false
    - Preserve existing numbered section detection logic for valid headings
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  
  - [x] 4.2 Write unit tests for list item filtering
    - Test the specific list pattern from `contraceptive_methods.do`
    - Test numbered line with exactly 4 spaces (should not detect)
    - Test numbered line with 3 spaces (should detect)
    - Test numbered line with tab character (should not detect)
    - Test numbered line at column 0 (should detect)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Add comprehensive integration tests
  - [x] 6.1 Write property test for backward compatibility
    - **Property 7: Backward Compatibility for Mixed Patterns**
    - **Validates: Requirements 4.5**
  
  - [x] 6.2 Write property test for no duplicate line detection
    - **Property 8: No Duplicate Line Detection**
    - **Validates: Requirements 5.4**
  
  - [x] 6.3 Write integration tests for mixed pattern documents
    - Test document with all four pattern types
    - Test document with overlapping pattern candidates
    - Test document with block comments and regular banners
    - Test large document (1000+ lines) with mixed patterns
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5_
  
  - [x] 6.4 Write regression tests for existing patterns
    - Test existing single-line section patterns
    - Test existing banner section patterns
    - Test existing starred inline section patterns
    - Test existing numbered section patterns (without indentation)
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties (minimum 100 iterations each)
- Unit tests validate specific examples and edge cases
- The implementation maintains O(N) performance by using single-pass algorithms with consumed line tracking
- All new functions follow the existing code style (snake_case for local variables, TypeScript conventions)
