# Implementation Plan: Option Completion After Comma

## Overview

This implementation enables option completions to appear after typing a comma in Stata commands and fixes the hover provider to show option-specific information instead of treating text after a comma as a command.

## Tasks

- [ ] 1. Fix Completion Provider to return options on empty prefix
  - [ ] 1.1 Remove early return in `get_option_completions` when prefix is empty
    - Modify `src/providers/completion.ts`
    - Remove the `if (option_prefix === '') { return []; }` check
    - _Requirements: 1.1, 1.2_

  - [ ] 1.2 Write property test for option completions after comma
    - **Property 1: Option completions returned for commands with options**
    - **Validates: Requirements 1.1**

- [ ] 2. Improve command name extraction for option context
  - [ ] 2.1 Verify command extraction handles colon syntax
    - Test that `merge 1:m foo using bar, ` extracts `merge`
    - Ensure existing `extract_command_name` handles this case
    - _Requirements: 2.1_

  - [ ] 2.2 Write property test for command name extraction
    - **Property 2: Command name extraction handles various formats**
    - **Validates: Requirements 2.1, 2.2, 2.3**

- [ ] 3. Add option context detection to Hover Provider
  - [ ] 3.1 Add `is_in_option_context` helper function
    - Add to `src/providers/hover.ts`
    - Detect comma before cursor position (not in quotes/parens)
    - Extract command name from text before comma
    - _Requirements: 3.1_

  - [ ] 3.2 Modify `get_hover` to check option context before command lookup
    - Add option context check early in the method
    - Skip command lookup when in option context
    - _Requirements: 3.1, 3.3_

  - [ ] 3.3 Write property test for hover suppression in option context
    - **Property 3: Hover suppression in option context**
    - **Validates: Requirements 3.1, 3.3**

- [ ] 4. Add option hover functionality
  - [ ] 4.1 Add `get_option_hover` method to Hover Provider
    - Look up command in database
    - Find matching option by name
    - Return formatted option documentation
    - _Requirements: 3.2_

  - [ ] 4.2 Integrate option hover into `get_hover` method
    - Call `get_option_hover` when in option context
    - Return option hover if found, null otherwise
    - _Requirements: 3.2_

  - [ ] 4.3 Write property test for option hover
    - **Property 4: Option hover for recognized options**
    - **Validates: Requirements 3.2**

- [ ] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- The completion provider change is minimal (removing one early return)
- The hover provider changes are more substantial but follow existing patterns
- Property tests use fast-check with minimum 100 iterations
