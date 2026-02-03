# Implementation Plan: SMCL Hyperlinked Option Extraction Fix

## Overview

This implementation plan addresses the bug in `parse_option_pattern()` where options using hyperlinked argument syntax like `{opth vce:(topic:display)}` are not being extracted. The fix involves adding two new regex patterns to handle the colon before the opening parenthesis in hyperlinked arguments.

## Tasks

- [ ] 1. Add hyperlinked argument pattern support to parse_option_pattern()
  - [-] 1.1 Add regex pattern for `{opt[h] abbrev:rest:(content)}` format
    - Add pattern matching before existing `abbrev_arg_match` pattern
    - Pattern: `/\{opt[h]?\s+([a-z][a-z0-9_]*):([a-z0-9_]+):\(([^)]+)\)\}/i`
    - Extract abbrev (group 1), rest (group 2), and argument content (group 3)
    - Return ExtractedOption with name=abbrev+rest, min_abbreviation=abbrev.length, has_argument=true
    - _Requirements: 1.2, 1.4_
  
  - [~] 1.2 Add regex pattern for `{opt[h] name:(content)}` format
    - Add pattern matching before existing `arg_match` pattern
    - Pattern: `/\{opt[h]?\s+([a-z][a-z0-9_]*):\(([^)]+)\)\}/i`
    - Extract name (group 1) and argument content (group 2)
    - Return ExtractedOption with name=name, min_abbreviation=name.length, has_argument=true
    - _Requirements: 1.1, 1.3_

- [ ] 2. Add unit tests for hyperlinked argument patterns
  - [~] 2.1 Add unit tests for specific hyperlinked patterns in smcl-extractor.test.ts
    - Test `{opth vce:(regress##vcetype:vcetype)}` extracts vce with has_argument=true
    - Test `{opth by:(varlist:groupvar)}` extracts by with has_argument=true
    - Test `{opt ef:orm:(strings:string)}` extracts eform with min_abbreviation=2
    - Test `{opt name:(topic:display)}` extracts name with has_argument=true
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 4.1, 4.2, 4.3_
  
  - [~] 2.2 Add property test for hyperlinked argument extraction (simple name)
    - **Property 1: Hyperlinked Argument Extraction (Simple Name)**
    - Generate random option names and hyperlinked argument content
    - Test both {opt} and {opth} tags
    - Verify name, has_argument=true, and argument_type are correct
    - **Validates: Requirements 1.1, 1.3, 4.1, 4.3**
  
  - [~] 2.3 Add property test for hyperlinked argument extraction (with abbreviation)
    - **Property 2: Hyperlinked Argument Extraction (With Abbreviation)**
    - Generate random abbreviation parts, rest parts, and hyperlinked argument content
    - Test both {opt} and {opth} tags
    - Verify name, min_abbreviation, has_argument=true, and argument_type are correct
    - **Validates: Requirements 1.2, 1.4**

- [~] 3. Checkpoint - Verify implementation and tests
  - Ensure all tests pass, ask the user if questions arise.
  - Run existing property tests to verify backward compatibility (Property 3)
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [ ] 4. Add integration test for regress.sthlp
  - [~] 4.1 Add test with mock regress.sthlp content containing vce option
    - Create mock SMCL content with `{opth vce:(regress##vcetype:vcetype)}`
    - Use `extract_commands_from_content()` to extract options
    - Verify vce option is present with has_argument=true
    - _Requirements: 3.1, 3.2_

- [~] 5. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
  - Verify backward compatibility by running full test suite
  - _Requirements: 3.3_

## Notes

- All tasks are required for comprehensive testing
- The fix is localized to `parse_option_pattern()` in `src/command-database/smcl-extractor.ts`
- Pattern matching order is critical - new patterns must be checked before existing patterns
- After implementation, regenerate the command cache with `bun scripts/generate-cache.ts` to include the newly extracted options
