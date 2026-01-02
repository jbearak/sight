# Implementation Plan: Global Macro Execution Order

## Overview

This implementation plan addresses foundational issues in the Stata LSP's cross-file awareness system: normalizing line number indexing, fixing diagnostic message formats, adding automatic call site inference, and removing the `directives_required` configuration.

## Tasks

- [x] 1. Normalize Line Number Indexing
  - [x] 1.1 Update `find_match_line` to return 0-indexed line numbers
    - Change return value from `i + 1` to `i` in DirectiveParser
    - _Requirements: 1.2_
  - [x] 1.2 Update `filter_by_call_site` to use 0-indexed comparison
    - Remove the `call_site_line - 1` conversion since input will now be 0-indexed
    - Update `OutOfScopeSymbol.call_site_line` to store 0-indexed values
    - _Requirements: 1.1, 1.3_
  - [x] 1.3 Update ScopeResolver call site handling
    - Convert user-provided `line=N` parameters from 1-indexed to 0-indexed
    - Use 0-indexed values from `find_match_line` directly
    - _Requirements: 1.1_
  - [x] 1.4 Write property test for find_match_line 0-indexed return
    - **Property 1: find_match_line Returns 0-Indexed Line Numbers**
    - **Validates: Requirements 1.2**
  - [x] 1.5 Audit cross-file codepaths for mixed 0/1-index handling
    - Search for remaining `+ 1` / `- 1` line conversions and mixed comparisons
    - Ensure all internal operations are 0-indexed; convert only at display boundaries
    - _Requirements: 1.1_

- [x] 2. Fix Diagnostic Message Formats
  - [x] 2.1 Update SemanticAnalyzer local macro message format
    - Ensure format is `Undefined local macro: \`name'` (backtick + apostrophe)
    - _Requirements: 2.1_
  - [x] 2.2 Update SemanticAnalyzer global macro message format
    - Change format to `Undefined global macro: $name` (with dollar sign)
    - _Requirements: 2.2_
  - [x] 2.3 Update token-based macro detection to match AST format
    - Ensure `check_token_macro_references` uses same format as AST path
    - _Requirements: 2.5_
  - [x] 2.4 Update DiagnosticsProvider symbol name extraction
    - Add regex to handle `$name` format for globals
    - Preserve existing `` `name' `` handling for locals
    - _Requirements: 2.3, 2.4_
  - [x] 2.5 Write property test for symbol name extraction round-trip
    - **Property 6: Symbol Name Extraction Round-Trip**
    - **Validates: Requirements 2.3, 2.4**
  - [x] 2.6 Write property test for AST/token diagnostic consistency
    - **Property 7: AST and Token Diagnostic Consistency**
    - **Validates: Requirements 2.5**

- [x] 3. Checkpoint - Verify foundational changes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement Automatic Call Site Inference
  - [x] 4.1 Add `infer_call_site_for_file` method to DirectiveParser
    - Implement pattern matching for `do`/`include`/`run` statements
    - Handle quoted and unquoted paths
    - Handle with/without `.do` suffix
    - Return 0-indexed line number or undefined
    - _Requirements: 4.1, 4.2, 4.6_
  - [x] 4.2 Add `extract_filename` helper to ScopeResolver
    - Extract filename from URI for inference matching
    - _Requirements: 4.1_
  - [x] 4.3 Integrate call site inference into `follow_directives`
    - Call `infer_call_site_for_file` when no explicit call site provided
    - Fall back to `assume_call_site` config when inference fails
    - _Requirements: 4.1, 4.4_
  - [x] 4.4 Ensure explicit parameters override inference
    - Check for `match=` or `line=` before attempting inference
    - _Requirements: 4.5_
  - [x] 4.5 Write property test for call site inference correctness
    - **Property 8: Call Site Inference Correctness**
    - **Validates: Requirements 4.1, 4.2**
  - [x] 4.6 Write property test for first match behavior
    - **Property 9: Call Site Inference First Match**
    - **Validates: Requirements 4.3**
  - [x] 4.7 Write property test for suffix handling
    - **Property 12: Call Site Inference Suffix Handling**
    - **Validates: Requirements 4.6**

- [x] 5. Checkpoint - Verify call site inference
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Remove `directives_required` Configuration
  - [x] 6.1 Remove from CrossFileConfig interface in types
    - Remove `directives_required: boolean` field
    - _Requirements: 3.1, 3.2_
  - [x] 6.2 Remove from default config in server-handlers.ts
    - Remove `directives_required: false` from DEFAULT_CONFIG
    - _Requirements: 3.1_
  - [x] 6.3 Update config-validator.ts to ignore the field
    - Remove validation logic for `directives_required`
    - Optionally log warning if field is present (deprecated)
    - _Requirements: 3.1_
  - [x] 6.4 Update workspace-config.ts mapping
    - Remove `directivesRequired` mapping logic
    - _Requirements: 3.1_
  - [x] 6.5 Remove conditional logic from completion.ts
    - Remove `config?.cross_file?.directives_required` checks
    - Simplify workspace symbol resolution logic
    - _Requirements: 3.1_
  - [x] 6.6 Update tests that reference `directives_required`
    - Remove from test configs
    - Update property tests in config-mapping-type-safety.prop.test.ts
    - _Requirements: 3.1_

- [x] 7. Update Display Line Numbers
  - [x] 7.1 Audit all diagnostic messages that display line numbers
    - Identify all places where line numbers appear in user-facing messages
    - Currently known: out-of-scope diagnostic in DiagnosticsProvider
    - Check for any other diagnostic messages that include line references
    - _Requirements: 1.4_
  - [x] 7.2 Update out-of-scope diagnostic message in DiagnosticsProvider
    - Convert 0-indexed `call_site_line` to 1-indexed for display
    - Format: `'name' is defined in file but after the call site (line N)`
    - _Requirements: 1.4_
  - [x] 7.3 Update any other diagnostic messages with line numbers
    - Apply same 0-indexed to 1-indexed conversion for display
    - Ensure all user-facing line numbers are 1-indexed
    - _Requirements: 1.4_
  - [x] 7.4 Write property test for display line conversion
    - **Property 3: Display Line Numbers Are 1-Indexed**
    - **Validates: Requirements 1.4**

- [x] 8. Checkpoint - Verify all changes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Update Documentation
  - [x] 9.1 Update README.md cross-file awareness section
    - Remove `directives_required` documentation
    - Add automatic call site inference documentation
    - Update directive examples
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 10. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks including property tests are required for comprehensive coverage
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
