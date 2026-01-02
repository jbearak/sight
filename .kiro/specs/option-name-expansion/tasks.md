# Implementation Plan: Option Name Expansion

## Overview

Extend the parser to expand abbreviated option names using command-specific option dictionaries. Depends on command-name-expansion being complete first.

## Prerequisites

- command-name-expansion feature must be implemented first (parser needs command fullName to look up options)

## Tasks

- [ ] 1. Add option expansion to CommandDatabase
  - [ ] 1.1 Add `expand_option(command_name, option_abbrev)` method
    - Look up command, iterate its options
    - Check if abbrev is valid (length >= minAbbrev, prefix of name)
    - Return canonical name or fall back to common options
    - _Requirements: 1.1, 1.3, 2.1, 2.2_
  - [ ] 1.2 Add `expand_common_option()` private method
    - Define common options: robust, detail, level, noconstant, etc.
    - Return canonical name or original if not found
    - _Requirements: 2.3, 2.4_

- [ ] 2. Wire option expansion to parser
  - [ ] 2.1 Update option parsing to call `expand_option()`
    - Pass command's fullName and option text
    - Set option.fullName to result
    - _Requirements: 1.1, 1.2_
  - [ ] 2.2 Write property test for command-specific expansion
    - **Property 1: Command-Specific Option Expansion**
    - **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2**
  - [ ] 2.3 Write property test for common option fallback
    - **Property 2: Common Option Fallback**
    - **Validates: Requirements 2.3, 2.4**
  - [ ] 2.4 Write property test for unknown options unchanged
    - **Property 3: Unknown Options Unchanged**
    - **Validates: Requirements 5.5**

- [ ] 3. Checkpoint - Ensure parser tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Verify round-trip preservation
  - [ ] 4.1 Confirm pretty printer uses option `name` field (not `fullName`)
    - Check `printOption()` method
    - _Requirements: 3.2_
  - [ ] 4.2 Write property test for round-trip preservation
    - **Property 4: Round-trip Preservation**
    - **Validates: Requirements 3.2, 3.4**

- [ ] 5. Update hover provider (optional enhancement)
  - [ ] 5.1 Show option expansion in hover when name != fullName
    - Display "`rob` → `robust`" in hover tooltip
    - _Requirements: 4.1, 4.2_

- [ ] 6. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- This feature depends on command-name-expansion (needs command fullName for lookup)
- Common options provide fallback for unknown commands
- Pretty printer already uses `name` field, so round-trip should work automatically
