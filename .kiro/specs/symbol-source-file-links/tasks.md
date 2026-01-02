# Implementation Plan: Symbol Source File Links

## Overview

This implementation adds clickable file links to hover information for symbols defined in other files. The changes are localized to the hover provider with minimal impact on existing functionality.

## Tasks

- [x] 1. Add helper methods for source link formatting
  - [x] 1.1 Add `get_display_path()` method to HoverProvider
    - Convert file:// URI to filesystem path
    - Calculate relative path when file is within workspace root
    - Return full path when file is outside workspace
    - _Requirements: 1.4, 3.2, 3.3_

  - [x] 1.2 Add `format_source_link()` method to HoverProvider
    - Return empty string when sourceUri equals currentUri
    - Return markdown link format `[display_path](uri)` for cross-file symbols
    - Use `get_display_path()` for the link text
    - _Requirements: 1.1, 3.1, 3.4_

  - [x] 1.3 Write unit tests for helper methods
    - Test `get_display_path()` with workspace-relative paths
    - Test `get_display_path()` with paths outside workspace
    - Test `format_source_link()` returns empty for same-file
    - Test `format_source_link()` returns valid markdown link
    - _Requirements: 1.1, 1.3, 1.4_

- [x] 2. Update macro hover to use clickable links
  - [x] 2.1 Update `get_macro_hover()` for local macros
    - Replace plain text source display with `format_source_link()` call
    - Pass workspace root if available
    - Show `Defined at:` for same-file symbols
    - Display macro expansion with double-backtick escaping: `` ``value`` ``
    - _Requirements: 2.1_

  - [x] 2.2 Update `get_macro_hover()` for global macros
    - Replace plain text source display with `format_source_link()` call
    - Show `Defined at:` for same-file symbols
    - Display macro expansion with double-backtick escaping
    - _Requirements: 2.2_

  - [x] 2.3 Write unit tests for macro hover links
    - Test local macro from another file shows clickable link
    - Test global macro from another file shows clickable link
    - Test macro from current file shows no redundant link
    - _Requirements: 2.1, 2.2, 1.3_

- [x] 3. Update program hover to use clickable links
  - [x] 3.1 Update `get_hover_for_user_program()` method
    - Replace plain text source display with `format_source_link()` call
    - Use `Source:` label for clickable links, `Defined at:` for same-file
    - _Requirements: 2.3_

  - [x] 3.2 Write unit tests for program hover links
    - Test program from another file shows clickable link
    - Test program from current file shows no redundant link
    - _Requirements: 2.3, 1.3_

- [x] 4. Update scalar/matrix hover to use clickable links
  - [x] 4.1 Update `get_scalar_matrix_hover()` method
    - Replace plain text source display with `format_source_link()` call for scalars
    - Replace plain text source display with `format_source_link()` call for matrices
    - Use `Source:` label for clickable links, `Defined at:` for same-file
    - _Requirements: 2.4, 2.5_

  - [x] 4.2 Write unit tests for scalar/matrix hover links
    - Test scalar from another file shows clickable link
    - Test matrix from another file shows clickable link
    - _Requirements: 2.4, 2.5_

- [x] 5. Checkpoint - Ensure all tests pass
  - All tests pass, no issues.

- [x] 6. Write property tests for source link formatting
  - [x] 6.1 Write property test for cross-file link generation
    - **Property 1: Cross-file symbols have clickable markdown links**
    - **Validates: Requirements 1.1, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.4**

  - [x] 6.2 Write property test for same-file link suppression
    - **Property 2: Same-file symbols have no source link**
    - **Validates: Requirements 1.3**

  - [x] 6.3 Write property test for path relativization
    - **Property 3: Path display is workspace-relative when applicable**
    - **Validates: Requirements 1.4, 3.2, 3.3**

- [x] 7. Final checkpoint - Ensure all tests pass
  - All 2451 tests pass.

- [x] 8. Refactor hover formatting
  - [x] 8.1 Remove redundant "Defined at:" when clickable "Source:" link is available
    - Keep "Defined at:" only for same-file symbols
    - _Requirements: 1.3_

  - [x] 8.2 Rename "Value:" to "Expansion:" for macro hover
    - Better semantic clarity for macro values
    - _Requirements: 1.1_

  - [x] 8.3 Escape macro expansion with code blocks
    - Change format from `Expansion: \`value\`` to `Expansion: \`\`\`\nvalue\n\`\`\``
    - Code blocks properly escape backticks and special characters
    - _Requirements: 1.1_

- [x] 9. Add line numbers and improve same-file display
  - [x] 9.1 Add line numbers to all macro hover displays
    - Show line numbers (1-indexed) for all macros
    - Format: `Source: [path](uri), line X` for cross-file
    - Format: `Defined at: this file, line X` for same-file
    - _Requirements: 1.1, 1.3_

  - [x] 9.2 Improve same-file macro display
    - Show "this file, line X" instead of full URI
    - Better UX for same-file symbols
    - _Requirements: 1.3_

## Notes

- The implementation is localized to `src/providers/hover.ts`
- Existing hover functionality is preserved; only the source display format changes
- VS Code automatically handles markdown link clicks to open files
- All 2451 tests pass (28 unit tests + 3 property tests with 100 iterations each)
- Line numbers are 1-indexed for user-friendly display
- Macro expansions use code blocks for proper escaping of special characters
