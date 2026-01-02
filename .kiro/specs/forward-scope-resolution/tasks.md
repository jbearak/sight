# Implementation Plan: Forward Scope Resolution

## Overview

This implementation extends the Stata LSP's cross-file scope resolution to support forward-looking resolution via `do`, `run`, and `include` commands and their directive equivalents. The implementation builds on the existing `ScopeResolver` infrastructure and follows a layered approach: types first, then parsing, then resolution logic, then provider integration.

## Tasks

- [ ] 1. Define types and interfaces
  - [ ] 1.1 Add forward call types to `src/types/index.ts`
    - Add `ForwardCallType`, `EffectiveCallType`, `ForwardCall`, `ForwardCallDirective`
    - Add `ForwardResolveContext`, `ForwardResolvedScope`, `ForwardCallSite`
    - Add `DuplicateCallDecision` type
    - Extend `CrossFileConfig` with `max_forward_depth`
    - _Requirements: 1.1-1.7, 2.1-2.5, 12.1-12.4, 14.1-14.4_

  - [ ] 1.2 Write property test for type definitions
    - **Property 5: Do/Run Inheritance Excludes Locals**
    - **Property 6: Include Inheritance Preserves All Symbols**
    - **Validates: Requirements 2.1, 2.2, 2.3**

- [ ] 2. Extend DirectiveParser for forward call directives
  - [ ] 2.1 Add forward call directive parsing to `src/directive-parser/index.ts`
    - Add regex pattern for `@lsp-(do|run|include)`
    - Parse directives anywhere in file (not just header)
    - Extract path (quoted/unquoted), line=, match= parameters
    - Return `forward_calls` array in `DirectiveParseResult`
    - _Requirements: 1.1-1.7_

  - [ ] 2.2 Write property tests for directive parsing
    - **Property 1: Forward Directive Parsing Correctness**
    - **Property 2: Quoted and Unquoted Path Equivalence**
    - **Property 3: Legacy Syntax Acceptance**
    - **Property 4: Parameter Extraction Correctness**
    - **Validates: Requirements 1.1-1.7**

  - [ ] 2.3 Write unit tests for directive parsing edge cases
    - Test malformed directives
    - Test directives in various comment styles (* and //)
    - Test path resolution with .do fallback
    - _Requirements: 1.1-1.7_

- [ ] 3. Checkpoint - Ensure directive parsing tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Extend Analyzer for forward call command detection
  - [ ] 4.1 Add forward call detection to `src/analyzer/index.ts`
    - Detect `do`, `run`, `include` commands (case-insensitive, with abbreviations)
    - Extract path from first argument (quoted/unquoted)
    - Mark as non-static if path contains macro references
    - Record forward calls in analysis result
    - _Requirements: 9.1-9.5_

  - [ ] 4.2 Write property tests for command detection
    - **Property 24: Command Detection for All Call Types**
    - **Property 25: Unquoted Command Path Resolution**
    - **Property 26: Macro Path Non-Resolution**
    - **Validates: Requirements 9.1-9.5**

  - [ ] 4.3 Write unit tests for command detection edge cases
    - Test prefix commands (quietly do, capture include)
    - Test various path formats
    - Test macro path detection
    - _Requirements: 9.1-9.5_

- [ ] 5. Checkpoint - Ensure analyzer tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Implement ForwardScopeResolver
  - [ ] 6.1 Create `src/forward-scope-resolver/index.ts`
    - Implement `ForwardScopeResolver` class
    - Implement `resolve()` method with recursive resolution
    - Implement `apply_forward_inheritance()` function
    - Implement `compute_effective_call_type()` function
    - Implement `should_process_call()` for duplicate handling
    - Reuse `ScopeResolver` file cache
    - _Requirements: 2.1-2.5, 3.1-3.4, 5.1-5.5, 12.1-12.4, 13.1-13.3_

  - [ ] 6.2 Write property tests for inheritance rules
    - **Property 7: Symbol Accumulation Order**
    - **Property 8: Later Definition Wins**
    - **Validates: Requirements 2.4, 2.5**

  - [ ] 6.3 Write property tests for recursive resolution
    - **Property 9: Recursive Resolution Completeness**
    - **Property 10: Depth Limit Enforcement**
    - **Property 11: Cycle Detection**
    - **Property 12: Backward Directive Isolation**
    - **Validates: Requirements 3.1-3.4, 14.3**

  - [ ] 6.4 Write property tests for duplicate call handling
    - **Property 30: Duplicate Do/Run Call Optimization**
    - **Property 31: Do-Then-Include Adds Only Locals**
    - **Property 32: Include-First Skips Subsequent Calls**
    - **Validates: Requirements 12.1-12.3**

  - [ ] 6.5 Write property tests for include downgrade
    - **Property 33: Include Downgrade in Do Chain**
    - **Property 34: Include Preservation in Include Chain**
    - **Validates: Requirements 13.1, 13.2**

- [ ] 7. Checkpoint - Ensure forward scope resolver tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Implement ignore directive filtering
  - [ ] 8.1 Add ignore filtering to forward call extraction
    - Filter forward calls based on `@lsp-ignore` / `@lsp-ignore-next`
    - Implement in a separate filtering step (not in parser)
    - Access directive parsing results and statement boundaries
    - _Requirements: 4.1-4.3_

  - [ ] 8.2 Write property tests for ignore filtering
    - **Property 13: Ignore Directive Skips Call**
    - **Property 14: Ignored Call Diagnostic Isolation**
    - **Validates: Requirements 4.1-4.3**

- [ ] 9. Implement call-site filtering
  - [ ] 9.1 Add call-site aware symbol lookup
    - Implement `get_symbols_at_line()` function
    - Track call sites with their visibility boundaries
    - Filter symbols based on query line
    - _Requirements: 6.1-6.3_

  - [ ] 9.2 Write property tests for call-site filtering
    - **Property 17: Call-Site Visibility Boundary**
    - **Property 18: Independent Call Site Tracking**
    - **Validates: Requirements 6.1-6.3**

- [ ] 10. Checkpoint - Ensure call-site filtering tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Implement cache integration
  - [ ] 11.1 Integrate with existing ScopeResolver cache
    - Reuse file cache from ScopeResolver
    - Implement cache invalidation for forward-resolved scopes
    - _Requirements: 5.1-5.5_

  - [ ] 11.2 Write property tests for cache behavior
    - **Property 15: Cache Hit on Unchanged Content**
    - **Property 16: Cache Invalidation on Change**
    - **Validates: Requirements 5.1-5.3**

- [ ] 12. Integrate with diagnostics provider
  - [ ] 12.1 Update `src/providers/diagnostics.ts`
    - Use forward-resolved scope for undefined macro checks
    - Apply call-site filtering for diagnostic positions
    - Emit diagnostics for missing files
    - Do NOT surface callee diagnostics to caller
    - _Requirements: 7.1-7.4_

  - [ ] 12.2 Write property tests for diagnostic integration
    - **Property 19: Diagnostic Suppression After Call Site**
    - **Property 20: Diagnostic Reported Before Call Site**
    - **Property 21: Missing File Diagnostic**
    - **Validates: Requirements 7.1-7.3**

- [ ] 13. Integrate with completion provider
  - [ ] 13.1 Update `src/providers/completion.ts`
    - Include forward-resolved symbols in completions
    - Apply call-site filtering for completion positions
    - Add source attribution for callee symbols
    - _Requirements: 8.1-8.3_

  - [ ] 13.2 Write property tests for completion integration
    - **Property 22: Completion Includes Callee Symbols After Call Site**
    - **Property 23: Completion Source Attribution**
    - **Validates: Requirements 8.1-8.3**

- [ ] 14. Checkpoint - Ensure provider integration tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 15. Implement bidirectional scope merging
  - [ ] 15.1 Integrate forward and backward resolution
    - Process backward directives first, then forward calls
    - Merge symbols respecting execution order precedence
    - Ensure AST is unchanged after resolution
    - _Requirements: 10.1-10.3, 11.1-11.2_

  - [ ] 15.2 Write property tests for bidirectional merging
    - **Property 27: Bidirectional Symbol Merging**
    - **Property 28: Execution Order Precedence**
    - **Property 29: AST Unchanged After Forward Resolution**
    - **Validates: Requirements 10.1-10.3, 11.1-11.2**

- [ ] 16. Add configuration support
  - [ ] 16.1 Update configuration handling
    - Add `max_forward_depth` to config schema
    - Update `src/utils/workspace-config.ts` for new setting
    - Update `src/utils/config-validator.ts` for validation
    - Set default value of 10
    - _Requirements: 14.1-14.4_

  - [ ] 16.2 Write property test for configuration
    - **Property 35: Configurable Max Depth**
    - **Validates: Requirements 14.1**

  - [ ] 16.3 Write unit tests for configuration
    - Test default value
    - Test custom value from .stata-lsp.json
    - _Requirements: 14.2, 14.4_

- [ ] 17. Write integration tests
  - [ ] 17.1 Create integration test file
    - Test full forward resolution pipeline with real files
    - Test bidirectional merging scenarios
    - Test completion with forward-resolved symbols
    - Test diagnostic suppression scenarios
    - _Requirements: All_

- [ ] 18. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 19. Update exports and documentation
  - [ ] 19.1 Update barrel exports
    - Export new types from `src/types/index.ts`
    - Export `ForwardScopeResolver` from `src/index.ts`
    - _Requirements: All_

  - [ ] 19.2 Update README documentation
    - Document `@lsp-do`, `@lsp-run`, `@lsp-include` directives
    - Document `max_forward_depth` configuration
    - Add examples of forward scope resolution
    - _Requirements: All_

## Notes

- All tasks are required for comprehensive implementation
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- The implementation reuses existing infrastructure (ScopeResolver cache, DirectiveParser patterns) to minimize code duplication
