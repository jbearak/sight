# Implementation Plan: Varlist Parsing Consolidation

## Overview

This plan refactors `parseCommand` to delegate to `parseCommandBody` for standard commands, eliminating ~100 lines of duplicated varlist/expression/qualifier/option parsing logic.

## Tasks

- [ ] 1. Refactor parseCommand to delegate to parseCommandBody
  - [ ] 1.1 Remove duplicated varlist parsing code from parseCommand
    - Locate the varlist parsing loop (lines ~870-910)
    - Remove file path coalescing code
    - Remove varlist while-loop with parenthesized groups and wildcards
    - _Requirements: 1.1, 1.4_
  - [ ] 1.2 Remove duplicated expression and qualifier parsing from parseCommand
    - Remove expression parsing after `=`
    - Remove if-qualifier parsing
    - Remove in-qualifier parsing
    - _Requirements: 1.1, 1.4_
  - [ ] 1.3 Remove duplicated option parsing from parseCommand
    - Remove option parsing loop after comma
    - Remove option argument parsing
    - _Requirements: 1.1, 1.4_
  - [ ] 1.4 Add delegation to parseCommandBody
    - After frame prefix check, add: `return this.parseCommandBody(command_token, prefixes, start_token);`
    - _Requirements: 1.1, 1.4_

- [ ] 2. Verify existing tests pass
  - [ ] 2.1 Run parser unit tests
    - Execute `bun test tests/unit/parser`
    - Ensure no regressions
    - _Requirements: 1.4, 2.1_
  - [ ] 2.2 Run parser property tests
    - Execute `bun test tests/property`
    - Verify frame-prefixed-parenthesized-varlist tests pass
    - _Requirements: 1.4, 2.1, 2.2_


- [ ] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Write additional property tests
  - [ ] 4.1 Write property test for standard command AST correctness
    - **Property 1: AST Equivalence for Standard Commands**
    - Generate random commands with varlists, expressions, qualifiers, options
    - Verify AST structure is correct
    - **Validates: Requirements 1.4, 2.1**
  - [ ] 4.2 Write property test for wildcard operator handling
    - Generate commands with * and ? operators in varlist position
    - Verify wildcards appear correctly in AST varlist
    - **Validates: Requirements 2.3**
  - [ ] 4.3 Write property test for file command path coalescing
    - Generate file commands (do, run, include) with various path formats
    - Verify path tokens are coalesced correctly
    - **Validates: Requirements 2.4**

- [ ] 5. Verify special commands still work
  - [ ] 5.1 Test unab command parsing
    - Verify `unab macroname : varlist` parses correctly
    - _Requirements: 1.2_
  - [ ] 5.2 Test args command parsing
    - Verify `args name1 name2` parses correctly
    - _Requirements: 1.2_
  - [ ] 5.3 Test frame prefix parsing
    - Verify `frame name: command` parses correctly
    - _Requirements: 1.3_

- [ ] 6. Final checkpoint - Ensure all tests pass
  - Run full test suite: `bun run test`
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- The refactoring is low-risk since `parseCommandBody` is already tested via `parseFramePrefixedCommand`
- Existing property tests provide comprehensive coverage
- The main validation is that existing tests continue to pass
- Code reduction: ~100 lines removed from `parseCommand`
