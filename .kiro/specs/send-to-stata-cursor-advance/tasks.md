# Implementation Plan: Send-to-Stata Cursor Advance

## Overview

This implementation adds automatic cursor advancement after sending a single line to Stata. The changes are localized to the client extension, primarily modifying `commands.ts` and adding a new configuration setting.

## Tasks

- [x] 1. Add configuration setting for cursor advance
  - [x] 1.1 Add `sight.sendToStata.advanceCursorOnSend` setting to `client/package.json`
    - Type: boolean, default: true
    - Add description explaining the behavior
    - Place under existing `sight.sendToStata` settings group
    - _Requirements: 2.1, 2.2_

- [x] 2. Implement cursor advancement logic
  - [x] 2.1 Create `advance_cursor_if_enabled` helper function in `commands.ts`
    - Accept editor and statement_end_line parameters
    - Read `advanceCursorOnSend` setting
    - Calculate next line position
    - Handle edge case when cursor is on last line
    - Move cursor to (next_line, 0) with empty selection
    - Call `editor.revealRange` to ensure visibility
    - _Requirements: 1.1, 1.2, 1.5, 3.1, 3.2, 3.3_
  
  - [x] 2.2 Modify `handle_send_command` to track single-line send context
    - Detect when mode is 'statement' and selection is empty
    - Capture statement bounds before sending
    - _Requirements: 1.1, 1.3_
  
  - [x] 2.3 Call `advance_cursor_if_enabled` after successful send
    - Only call for single-line sends (statement mode, no selection)
    - Pass the statement end line from captured bounds
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 3. Checkpoint - Verify basic functionality
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Write tests for cursor advancement
  - [x] 4.1 Write property test for next line calculation
    - **Property 1: Next Line Calculation**
    - Generate random statement bounds, verify next_line = end_line + 1
    - **Validates: Requirements 1.1, 1.2**
  
  - [x] 4.2 Write property test for selection mode behavior
    - **Property 2: Selection Mode Prevents Advancement**
    - Generate random editor states with selections, verify should_advance = false
    - **Validates: Requirements 1.3**
  
  - [x] 4.3 Write property test for disabled setting behavior
    - **Property 3: Disabled Setting Prevents Advancement**
    - Generate random send contexts with setting=false, verify no cursor movement
    - **Validates: Requirements 2.3**
  
  - [x] 4.4 Write property test for cursor state after advancement
    - **Property 4: Cursor State After Advancement**
    - Generate random advancement operations, verify cursor at (line, 0) with empty selection
    - **Validates: Requirements 3.1, 3.2**
  
  - [x] 4.5 Write unit tests for edge cases
    - Test cursor on last line stays in place
    - Test file mode does not advance
    - Test upward/downward modes do not advance
    - _Requirements: 1.4, 1.5_

- [ ] 5. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks including tests are required
- The implementation is localized to `client/src/send-to-stata/commands.ts`
- No changes needed to the LSP server
- Configuration follows existing patterns in `client/package.json`
