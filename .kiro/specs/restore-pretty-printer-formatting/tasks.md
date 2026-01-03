# Implementation Plan: Configurable Formatter Mode

## Overview

This implementation adds a configurable formatter mode setting and fixes the indentation bug in the source-preserving formatter. The source-preserving formatter remains the default, with AST-based formatting available as an experimental option.

## Tasks

- [x] 1. Fix source-preserving indentation bug
  - [x] 1.1 Investigate indentation bug in TokenReconstructor
    - Trace indent_size from FormattingOptions through to output
    - Identify where 4-space indent is being changed to 2-space
    - _Requirements: 5.1, 5.2_
  - [x] 1.2 Fix the indentation bug
    - Ensure FormatterConfig.indent_size is correctly used
    - Verify TokenReconstructor.make_indent() uses configured size
    - _Requirements: 5.1, 5.2, 5.3_
  - [x] 1.3 Write property test for indent size preservation
    - **Property 6: Indent Size Preservation**
    - **Validates: Requirements 5.1, 5.2, 5.3**

- [x] 2. Add formatter mode to configuration types
  - [x] 2.1 Update StataLSPConfig type in `src/types/index.ts`
    - Add `mode: 'source-preserving' | 'ast'` to formatting config
    - _Requirements: 1.1, 1.2_
  - [x] 2.2 Update DEFAULT_SETTINGS in `src/server-handlers.ts`
    - Set default mode to "source-preserving"
    - _Requirements: 1.5_
  - [x] 2.3 Update config validator in `src/utils/config-validator.ts`
    - Add validation for formatting.mode
    - Fall back to "source-preserving" for invalid values
    - _Requirements: 1.2_

- [x] 3. Update CodeFormatter to support mode switching
  - [x] 3.1 Update `src/providers/formatter.ts` to accept config
    - Add config parameter to format() method
    - Read mode from config.formatting.mode
    - _Requirements: 1.1, 1.3, 1.4_
  - [x] 3.2 Implement mode dispatching logic
    - Dispatch to format_with_source_preserving() for "source-preserving"
    - Dispatch to format_with_ast() for "ast"
    - Default to source-preserving if mode is undefined
    - _Requirements: 1.3, 1.4, 1.5_
  - [x] 3.3 Implement format_with_ast() method
    - Use PrettyPrinter to format document
    - Handle errors by returning empty edits (no fallback)
    - Log warnings on errors
    - _Requirements: 3.1, 3.2, 3.3, 4.1, 4.2, 4.3_
  - [x] 3.4 Write property test for mode selection
    - **Property 1: Mode Selection Correctness**
    - **Validates: Requirements 1.3, 1.4**

- [x] 4. Checkpoint - Verify formatter mode switching works
  - Test with mode="source-preserving" (should use token-based formatter)
  - Test with mode="ast" (should use PrettyPrinter)
  - Test with no mode (should default to source-preserving)
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Update server handlers to pass config to formatter
  - [x] 5.1 Update formatting handler in `src/server-handlers.ts`
    - Pass StataLSPConfig to CodeFormatter.format()
    - _Requirements: 1.1, 2.4_
  - [x] 5.2 Update format_with_comment_normalization if needed
    - Ensure mode is respected when comment normalization is enabled
    - _Requirements: 1.3, 1.4_

- [x] 6. Add VS Code extension setting
  - [x] 6.1 Update `client/package.json` contributes.configuration
    - Add sight.formatting.mode setting
    - Set enum values: ["source-preserving", "ast"]
    - Set default to "source-preserving"
    - Add description noting "ast" is experimental
    - _Requirements: 2.1, 2.2, 2.3_
  - [x] 6.2 Update extension to read and pass setting to server
    - Read sight.formatting.mode from workspace configuration
    - Pass to server via workspace/didChangeConfiguration
    - _Requirements: 2.4_

- [x] 7. Final checkpoint - Ensure all tests pass
  - Verify indentation bug is fixed (4-space indent preserved)
  - Verify mode switching works end-to-end
  - Verify VS Code setting is exposed correctly
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required for comprehensive validation
- Task 1 (indentation bug fix) should be done first as it's a regression
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
