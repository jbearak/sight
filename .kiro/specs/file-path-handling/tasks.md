# Implementation Plan: File Path Handling

## Overview

This implementation adds support for unquoted file paths in commands and file path completions for directives. The approach uses context-aware parsing and completion detection.

## Tasks

- [x] 1. Create file path utilities module
  - [x] 1.1 Create src/utils/file-path-utils.ts
    - Define FILE_COMMANDS set (do, run, include, use, save, etc.)
    - Define PATH_DIRECTIVES set (@lsp-done-by, @lsp-included-by, etc.)
    - Define STATA_FILE_EXTENSIONS array
    - Add isFileCommand() and isPathDirective() helpers
    - _Requirements: 1.1, 3.1_

- [x] 2. Extend parser to coalesce file paths
  - [x] 2.1 Add parseFilePathArgument() method to StataParser
    - Consume all tokens until whitespace, comma, terminator, or trivia
    - Handle STRING tokens as-is (quoted paths)
    - Concatenate token values into single path string
    - Return single IdentifierNode with full path and range
    - _Requirements: 1.1, 1.4, 1.5_

  - [x] 2.2 Modify parseCommand() to use file path coalescing
    - Check if command is a file command using isFileCommand()
    - Call parseFilePathArgument() for first argument
    - Fall back to normal varlist parsing for other arguments
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 2.3 Write property test for unquoted path coalescing
    - **Property 1: Unquoted Path Coalescing**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**

  - [x] 2.4 Write property test for path with options
    - **Property 2: Path with Options Separation**
    - **Validates: Requirements 1.6**

  - [x] 2.5 Write property test for division preservation
    - **Property 3: Division Operator Preservation**
    - **Validates: Requirements 2.4**

  - [x] 2.6 Write property test for macro path coalescing
    - **Property 4: Macro Path Coalescing**
    - **Validates: Requirements 2.3**

- [x] 3. Checkpoint - Ensure parser tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Extend completion provider for directive paths
  - [x] 4.1 Add directive context detection to completion provider
    - Detect cursor position inside comment tokens
    - Parse comment for @lsp-* directive pattern
    - Extract directive name and partial path
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 4.2 Add file path completion logic
    - Resolve base directory from partial path
    - List files/directories in workspace
    - Filter by Stata file extensions
    - Return CompletionItems with file icons
    - _Requirements: 3.7, 3.9_

  - [x] 4.3 Add directory-only completion for @lsp-working-directory
    - Filter to show only directories
    - _Requirements: 3.6, 3.8_

  - [x] 4.4 Write property test for directive path completions
    - **Property 5: Directive Path Completion Context**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

  - [x] 4.5 Write property test for directory-only completions
    - **Property 6: Directory-Only Completions**
    - **Validates: Requirements 3.6, 3.8**

  - [x] 4.6 Write property test for Stata file filtering
    - **Property 7: Stata File Filtering**
    - **Validates: Requirements 3.7**

- [x] 5. Checkpoint - Ensure directive completion tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Extend completion provider for command paths
  - [x] 6.1 Add command context detection to completion provider
    - Detect cursor position after file commands
    - Extract command name and partial path
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 6.2 Integrate file path completions for commands
    - Reuse file path completion logic from 4.2
    - Prioritize .do files for do/run/include commands
    - _Requirements: 4.4, 4.5_

  - [x] 6.3 Write property test for command path completions
    - **Property 8: Command Path Completion Context**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**

- [x] 7. Checkpoint - Ensure command completion tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Verify integration with existing features
  - [x] 8.1 Run working directory tests
    - Verify @lsp-working-directory works with unquoted paths
    - _Requirements: 1.1, 2.1, 2.2_

  - [x] 8.2 Run quoted path tests
    - Verify quoted paths still work correctly
    - _Requirements: 2.1_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Run full test suite with `bun test`
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Parser coalescing consumes all tokens until whitespace, comma, terminator, or trivia
- This only applies to known file commands to preserve division operator behavior in other contexts
- Completion provider detects context from cursor position and surrounding tokens
- File path completions use workspace root as base directory
- Property tests validate universal correctness properties
- Filenames containing commas or spaces require quoted paths (Stata limitation) - unquoted path coalescing stops at comma
