# Implementation Plan: Syntax Command Parsing

## Overview

This implementation plan breaks down the syntax command parsing feature into discrete, incremental coding tasks. Each task builds on previous ones, with testing integrated throughout to catch errors early. The implementation follows the LSP architecture pipeline: Parser → Analyzer → Providers.

## Tasks

- [x] 1. Extend type definitions for syntax command support
  - Add `ArgumentSpec`, `OptionSpec`, `ProgramSignature`, and `SyntaxNode` types to `src/types/index.ts`
  - Extend `ProgramSymbol` to include optional `signature` field
  - Extend `StataNode` union to include `SyntaxNode`
  - Extend `ProgramNode` to include optional `signature` field
  - _Requirements: 1.1, 1.6_

- [x] 2. Implement syntax command parser
  - [x] 2.1 Implement `parseSyntaxCommand()` method in parser
    - Detect `syntax` keyword inside program body
    - Route to syntax-specific parsing logic
    - Return `SyntaxNode` with `ProgramSignature`
    - _Requirements: 1.1, 1.2_

  - [x] 2.2 Implement `parseArgumentSpec()` method
    - Recognize standard argument types: varlist, varname, newvarname, anything, if, in, using, =exp, name
    - Handle optional arguments in brackets
    - Extract argument ranges
    - _Requirements: 1.3, 1.5_

  - [x] 2.3 Write property test for argument parsing
    - **Property 3: Argument Extraction Order**
    - **Property 5: Standard Argument Type Recognition**
    - **Validates: Requirements 1.3, 1.5**

  - [x] 2.4 Implement `parseOptionSpec()` method
    - Recognize required marker (`*`)
    - Recognize optional marker (brackets)
    - Parse argument types and defaults
    - Extract option ranges
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 2.5 Implement `computeMinAbbreviation()` method
    - Compute per-option abbreviation based on casing
    - Handle mixed case, lowercase, uppercase
    - _Requirements: 2.5_

  - [x] 2.6 Write property test for option parsing
    - **Property 8: Optional Boolean Option Recognition**
    - **Property 9: Typed Option Recording**
    - **Property 10: Default Value Extraction**
    - **Property 12: Abbreviation Computation**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.5**

  - [x] 2.7 Implement error handling in parser
    - Emit warning for syntax outside program
    - Emit diagnostics for unknown argument types
    - Emit diagnostics for duplicate options
    - Implement error recovery
    - _Requirements: 1.2, 6.1, 6.2, 6.3_

  - [x] 2.8 Write property test for parser error handling
    - **Property 2: Out-of-Program Syntax Warning**
    - **Property 13: Duplicate Option Handling**
    - **Property 25: Graceful Error Recovery**
    - **Validates: Requirements 1.2, 2.6, 5.5, 6.1, 6.2, 6.3**

- [x] 3. Checkpoint - Ensure parser tests pass
  - Ensure all parser unit tests pass
  - Ensure all parser property tests pass
  - Ask the user if questions arise

- [x] 4. Implement signature extraction and attachment
  - [x] 4.1 Extend `parseProgramDefinition()` to extract signature
    - After parsing program body, scan for `SyntaxNode` instances
    - Merge multiple syntax commands (concatenate arguments, override options)
    - Attach merged signature to `ProgramNode`
    - _Requirements: 1.6, 3_

  - [x] 4.2 Write property test for signature attachment
    - **Property 7: Signature Attachment with Ranges**
    - **Validates: Requirements 1.6**

- [x] 5. Implement analyzer support for syntax commands
  - [x] 5.1 Implement `analyzeSyntaxNode()` method in analyzer
    - Validate argument types
    - Validate option syntax
    - Emit diagnostics for errors
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 5.2 Implement `registerImplicitLocals()` method
    - Register all arguments as implicit local macros
    - Register all options as implicit local macros
    - Mark as implicit to suppress undefined macro diagnostics
    - _Requirements: 6.4, 6.5_

  - [x] 5.3 Extend `analyzeProgramNode()` to extract and attach signature
    - Extract signature from program body
    - Attach to `ProgramSymbol` in symbol table
    - _Requirements: 6.4_

  - [x] 5.4 Write property test for implicit local registration
    - **Property 29: Implicit Local Registration**
    - **Property 30: Implicit Local Suppression of Undefined Macro Diagnostics**
    - **Validates: Requirements 6.4, 6.5**

  - [x] 5.5 Implement scope restriction for implicit locals
    - Restrict visibility to program body
    - Prevent leakage to global scope
    - Prevent shadowing of global macros
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 5.6 Write property test for scope restriction
    - **Property 31: Implicit Local Scope Restriction**
    - **Property 32: Implicit Local Non-Leakage**
    - **Property 33: Implicit Local Independence**
    - **Validates: Requirements 7.1, 7.2, 7.3**

  - [x] 5.7 Implement multiple syntax command handling
    - Merge arguments and options from multiple syntax commands
    - Handle option overrides
    - Register all implicit locals
    - _Requirements: 3, 6.6_

  - [x] 5.8 Write property test for multiple syntax commands
    - **Property 34: Multiple Syntax Commands Handling**
    - **Property 35: Command Validation Against Multiple Syntaxes**
    - **Validates: Requirements 3, 6.6, 7.4**

- [x] 6. Checkpoint - Ensure analyzer tests pass
  - Ensure all analyzer unit tests pass
  - Ensure all analyzer property tests pass
  - Ask the user if questions arise

- [x] 7. Implement completion provider support
  - [x] 7.1 Implement `getCompletionsForUserProgramCall()` method
    - Look up program signature from symbol table
    - Filter options by partial abbreviation
    - Return completions with descriptions
    - _Requirements: 3.1, 3.2_

  - [x] 7.2 Implement `formatOptionCompletion()` method
    - Format option name with abbreviation
    - Generate description from type
    - Insert placeholders for arguments
    - Differentiate required vs optional
    - _Requirements: 3.2, 3.3, 3.4_

  - [x] 7.3 Write property test for completion provider
    - **Property 14: Completion Filtering by Abbreviation**
    - **Property 15: Option Description Generation**
    - **Property 16: Placeholder Insertion for Arguments**
    - **Property 17: Completion Differentiation and Filtering**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4**

- [x] 8. Implement hover provider support
  - [x] 8.1 Implement `getHoverForUserProgram()` method
    - Look up program signature from symbol table
    - Format in Stata help-style
    - Return hover text
    - _Requirements: 4.1_

  - [x] 8.2 Implement `getHoverForOption()` method
    - Look up option in program signature
    - Show type, default, required status
    - Return hover text
    - _Requirements: 4.2_

  - [x] 8.3 Implement `formatSignatureForHover()` method
    - Format signature in Stata help-style
    - Show arguments in order
    - Show options with types and defaults
    - _Requirements: 4.1_

  - [x] 8.4 Implement error handling for missing signatures
    - Fail silently without throwing
    - Return empty hover text
    - _Requirements: 4.3_

  - [x] 8.5 Write property test for hover provider
    - **Property 18: Hover Signature Formatting**
    - **Property 19: Option Hover Information**
    - **Property 20: Hover Error Handling**
    - **Validates: Requirements 4.1, 4.2, 4.3**

- [x] 9. Implement pattern-specific handling
  - [x] 9.1 Test regression-style pattern: `syntax varlist [if] [in] [, options]`
    - Verify all components extracted correctly
    - _Requirements: 5.1_

  - [x] 9.2 Test flexible input pattern: `syntax anything [, options]` and variants
    - Verify flexible input handling
    - _Requirements: 5.2_

  - [x] 9.3 Test file-based pattern: `syntax [varlist] [if] [in] using ...`
    - Verify `using` keyword and filename requirement captured
    - _Requirements: 5.3_

  - [x] 9.4 Test generate-style pattern: `syntax newvarname = exp`
    - Verify expression requirement recorded
    - _Requirements: 5.4_

  - [x] 9.5 Write property test for pattern handling
    - **Property 21: Regression-Style Pattern Handling**
    - **Property 22: Flexible Input Pattern Handling**
    - **Property 23: File-Based Pattern Handling**
    - **Property 24: Generate-Style Pattern Handling**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**

- [x] 10. Checkpoint - Ensure all provider tests pass
  - Ensure all completion provider tests pass
  - Ensure all hover provider tests pass
  - Ensure all pattern handling tests pass
  - Ask the user if questions arise

- [x] 11. Integration testing
  - [x] 11.1 Write integration test for cross-file navigation
    - Test completion and hover work across files
    - _Requirements: 3, 4_

  - [x] 11.2 Write integration test with real-world patterns
    - Test with actual Stata code patterns
    - _Requirements: 5_

  - [x] 11.3 Performance validation
    - Measure parse time before and after
    - Verify increase < 5%
    - _Requirements: NFR.1_

- [x] 12. Final checkpoint - Ensure all tests pass
  - Ensure all unit tests pass
  - Ensure all property tests pass
  - Ensure all integration tests pass
  - Ask the user if questions arise

## Notes

- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- All code should follow the style guidelines in AGENTS.md (snake_case, units in variable names, etc.)
