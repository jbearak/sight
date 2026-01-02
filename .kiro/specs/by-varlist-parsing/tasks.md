# Implementation Plan: By Varlist Parsing

## Overview

Complete the by/bysort prefix parsing implementation. The parser already has PrefixNode infrastructure; this fills in the varlist extraction and adds sort modifier support.

## Tasks

- [ ] 1. Extend PrefixNode type
  - [ ] 1.1 Add `sortVars?: string[]` field to PrefixNode in `src/types/index.ts`
    - _Requirements: 2.1, 2.2_

- [ ] 2. Update parser prefix detection
  - [ ] 2.1 Add 'bysort' and 'bys' to isPrefixCommand()
    - _Requirements: 1.2, 1.3_

- [ ] 3. Implement by-prefix varlist parsing
  - [ ] 3.1 Parse grouping variables after by/bysort/bys until colon or `(`
    - Collect WORD tokens into varlist array
    - Stop at COLON or LPAREN
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - [ ] 3.2 Parse optional sort modifier `(sortvar)`
    - If LPAREN, consume and collect WORD tokens until RPAREN
    - Store in sortVars field
    - _Requirements: 2.1, 2.2, 2.3_
  - [ ] 3.3 Set fullName to canonical form ('by' or 'bysort')
    - 'bys' → 'bysort'
    - _Requirements: 1.3_
  - [ ] 3.4 Consume colon and report error if missing
    - _Requirements: 5.2, 5.3_
  - [ ] 3.5 Write property test for varlist extraction
    - **Property 1: By-prefix Varlist Extraction**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**
  - [ ] 3.6 Write property test for sort modifier separation
    - **Property 2: Sort Modifier Separation**
    - **Validates: Requirements 2.1, 2.2, 2.3**

- [ ] 4. Checkpoint - Ensure parser tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Update pretty printer
  - [ ] 5.1 Update printPrefix() to output varlist
    - Join varlist with spaces after prefix name
    - _Requirements: 3.3_
  - [ ] 5.2 Update printPrefix() to output sort modifier
    - Output ` (sortvar)` if sortVars present
    - _Requirements: 3.3_
  - [ ] 5.3 Write property test for round-trip consistency
    - **Property 3: Round-trip Consistency**
    - **Validates: Requirements 3.3, 3.4**

- [ ] 6. Update analyzer for by-prefix variables
  - [ ] 6.1 Include by-prefix varlist in undefined variable checking
    - When analyzing command with by-prefix, check varlist variables
    - _Requirements: 4.1, 4.2_
  - [ ] 6.2 Write property test for analyzer scope checking
    - **Property 4: Analyzer Scope Checking**
    - **Validates: Requirements 4.1, 4.2**

- [ ] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- The existing PrefixNode already has a `varlist` field, just need to populate it
- Edge case: `by` as standalone command (not prefix) is handled by existing logic—no colon means it's parsed as a command
- Continuation lines (///) should work automatically since lexer handles them
