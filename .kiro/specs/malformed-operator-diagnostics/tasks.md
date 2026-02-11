# Implementation Plan: Malformed Operator Diagnostics

## Overview

Implement detection of malformed operator sequences in Stata code with context-aware handling of C-style logical operators. The work proceeds in stages: lexer prerequisite (`~=` compound token), type/config extensions, the core `OperatorSequenceAnalyzer` with AST-based context detection, integration into `DiagnosticsProvider`, and tests. Each task builds incrementally on the previous.

**Key update**: C-style logical operators (`&&`, `||`) are now context-dependent:
- In `if`/`else if` control flow statements: valid but emit optional informational diagnostics
- In `if` qualifiers on commands: invalid and emit error diagnostics

## Tasks

- [x] 1. Lexer prerequisite: recognize `~=` as a compound operator token
  - [x] 1.1 Update the lexer's `case '~':` branch in `src/lexer/index.ts` to peek for `=` and produce a two-character `OPERATOR` token `~=`, matching the existing pattern for `!=`, `<=`, `>=`, `==`
    - _Requirements: Prerequisites, 4.2_
  - [x] 1.2 Write property test verifying `~=` tokenization
    - Generate random Stata expressions containing `~=` (no space) and verify the lexer produces a single OPERATOR token with value `~=`
    - Also verify `~ =` (with space) produces two separate OPERATOR tokens
    - _Requirements: Prerequisites, 4.2_

- [x] 2. Extend types, config, and diagnostic codes
  - [x] 2.1 Add `MALFORMED_OPERATOR = 6001`, `INVALID_OPERATOR_SEQUENCE = 6002`, and `CSTYLE_LOGICAL_IN_CONTROL_FLOW = 6003` to the `StataDiagnosticCode` enum in `src/types/index.ts`
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
  - [x] 2.2 Add `malformedOperator`, `invalidOperatorSequence`, and `cStyleLogicalInControlFlow` fields to `StataLSPConfig.diagnostics.severity` in `src/types/index.ts`
    - Type: `'error' | 'warning' | 'information' | 'hint' | 'off'`
    - _Requirements: 8.1, 8.2, 8.8_
  - [x] 2.3 Add default values to `DEFAULT_SETTINGS` in `src/server-handlers.ts`: `malformedOperator: 'warning'`, `invalidOperatorSequence: 'error'`, `cStyleLogicalInControlFlow: 'information'`
    - _Requirements: 8.6, 8.7, 8.9_
  - [x] 2.4 Add validation for the three new severity fields in `src/utils/config-validator.ts`, following the existing `undefinedMacro`/`undefinedVariable`/`styleWarnings` pattern
    - _Requirements: 8.1, 8.2, 8.8_
  - [x] 2.5 Expose `ignored_lines: Set<number>` on the `DocumentState` interface in `src/document-store.ts`, and populate it from the `SemanticAnalyzer`'s `AnalyzerConfig.ignored_lines` after analysis completes (in the `DocumentStore.update` path)
    - _Requirements: 7.1, 7.2_

- [x] 3. Checkpoint
  - Ensure all tests pass (`bun run test`), ask the user if questions arise.

- [x] 4. Implement the OperatorSequenceAnalyzer with context detection
  - [x] 4.1 Create `src/providers/operator-sequence-diagnostics.ts` with the `OperatorSequenceAnalyzer` class
    - Define `SUGGESTIBLE_PAIRS` map (`< =` → `<=`, `> =` → `>=`, `! =` → `!=`, `~ =` → `~=`, `= =` → `==`)
    - Define `INVALID_PAIRS` set (context-independent invalid combinations from Requirement 2)
    - Define `CSTYLE_LOGICAL_PAIRS` set (`| |`, `& &`) for context-dependent handling
    - Define `SPECIAL_MESSAGES`, `CSTYLE_QUALIFIER_MESSAGES`, `CSTYLE_CONTROL_FLOW_MESSAGES` maps
    - Define `ARITHMETIC_OPS`, `COMPARISON_OPS`, and `NEGATION_OPS` sets for the allowlist
    - Implement `get_operator_context()` helper to determine if operator is in control flow or qualifier context using AST
    - Implement `analyze(document: DocumentState, config: StataLSPConfig): Diagnostic[]`
    - Early return `[]` if all three config severities are `'off'`
    - Early return `[]` if `document.tokens` is empty
    - Scan tokens for adjacent OPERATOR pairs (separated only by WHITESPACE/CONTINUATION trivia; STATEMENT_TERMINATOR, COMMENT_LINE, COMMENT_BLOCK break adjacency)
    - For C-style logical pairs, check context and emit appropriate diagnostic (error for qualifier, informational for control flow)
    - Classify each pair: suggestible, invalid, cstyle_control_flow, allowed (comparison+arithmetic, negation+comparison), or unrecognized (skip)
    - Build diagnostic messages per Requirement 5 templates
    - Check `document.ignored_lines` for suppression (Requirement 7)
    - Apply config severity override; skip if category is `'off'`
    - Advance past second token on match to avoid overlapping diagnostics
    - _Requirements: 1.1–1.6, 2.1–2.7, 2a.1–2a.4, 4.1, 4.3, 4.4, 5.1–5.14, 6.1, 6.2, 7.1, 7.2, 8.1–8.10, 9.2, 9.3, 9.4_
  - [x] 4.2 Write property test: suggestible pair detection (Property 1)
    - **Property 1: Suggestible pair detection and diagnostics**
    - *For any* suggestible operator pair embedded as adjacent OPERATOR tokens, the analyzer emits exactly one diagnostic with Warning severity, code 6001, correct message template, and correct span
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 5.1, 5.3, 9.2**
  - [x] 4.3 Write property test: invalid pair detection (Property 2)
    - **Property 2: Invalid pair detection and diagnostics**
    - *For any* invalid operator pair (excluding C-style logical) embedded as adjacent OPERATOR tokens, the analyzer emits exactly one diagnostic with Error severity, code 6002, correct message
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 5.2, 5.3, 5.9, 5.12, 9.3**
  - [x] 4.3a Write property test: C-style logical in if qualifier context (Property 2a)
    - **Property 2a: C-style logical in if qualifier context**
    - *For any* C-style logical pair in an if qualifier context, the analyzer emits exactly one diagnostic with Error severity, code 6002, message noting single operator usage
    - **Validates: Requirements 2.6, 5.10, 5.11, 9.3**
  - [x] 4.3b Write property test: C-style logical in if control flow context (Property 2b)
    - **Property 2b: C-style logical in if control flow context**
    - *For any* C-style logical pair in an if/else if control flow context, the analyzer emits informational diagnostic (when config not 'off') with code 6003, suggesting single operator for consistency
    - **Validates: Requirements 2a.1, 2a.2, 5.13, 5.14, 9.4**
  - [x] 4.4 Write property test: no false positives for allowed adjacencies (Property 4)
    - **Property 4: No false positives for allowed adjacencies**
    - *For any* pair of adjacent operators in the allowlist (comparison+arithmetic in either order, negation before comparison), the analyzer emits zero diagnostics
    - **Validates: Requirements 4.3, 4.4**
  - [x] 4.5 Write property test: config severity override for suggestible (Property 8)
    - **Property 8: Config severity override (suggestible)**
    - *For any* suggestible pair and any `malformedOperator` config value, the diagnostic uses the configured severity; when `'off'`, zero suggestible diagnostics are emitted
    - **Validates: Requirements 8.1, 8.3, 8.5, 8.6**
  - [x] 4.6 Write property test: config severity override for invalid (Property 9)
    - **Property 9: Config severity override (invalid)**
    - *For any* invalid pair and any `invalidOperatorSequence` config value, the diagnostic uses the configured severity; when `'off'`, zero invalid diagnostics are emitted
    - **Validates: Requirements 8.2, 8.4, 8.5, 8.7**
  - [x] 4.7 Write property test: config severity override for C-style in control flow (Property 10)
    - **Property 10: Config severity override (C-style in control flow)**
    - *For any* C-style logical pair in control flow context and any `cStyleLogicalInControlFlow` config value, the diagnostic uses the configured severity; when `'off'`, zero diagnostics are emitted
    - **Validates: Requirements 2a.3, 2a.4, 8.8, 8.9, 8.10**

- [x] 5. Continuation and statement boundary handling
  - [x] 5.1 Ensure the adjacency scanner in `OperatorSequenceAnalyzer` correctly handles `///` continuation tokens between operators (treats them as trivia, so pairs spanning continuations are detected)
    - _Requirements: 6.1_
  - [x] 5.2 Write property test: continuation-spanning detection (Property 5)
    - **Property 5: Continuation-spanning detection**
    - *For any* malformed operator pair where the first operator is on one line and the second on the next connected by `///`, the analyzer still detects and emits a diagnostic
    - **Validates: Requirements 6.1**
  - [x] 5.3 Write property test: statement terminator boundary (Property 6)
    - **Property 6: Statement terminator boundary**
    - *For any* two operators separated by a statement terminator (newline in CR mode, `;` in semicolon mode), the analyzer emits zero diagnostics even if the pair would otherwise be malformed
    - **Validates: Requirements 6.2**

- [x] 6. Embedded context filtering and suppression
  - [x] 6.1 Integrate `OperatorSequenceAnalyzer` into `DiagnosticsProvider.get_diagnostics()` in `src/providers/diagnostics.ts`
    - Instantiate as a private field (same pattern as `indentation_analyzer`)
    - Call `analyze()` and filter results through the existing `is_in_embedded_context()` check
    - _Requirements: 3.1, 3.2_
  - [x] 6.2 Write property test: embedded context suppression (Property 3)
    - **Property 3: Embedded context suppression**
    - *For any* malformed operator pair placed inside a Mata or Python embedded block, the analyzer (via DiagnosticsProvider filtering) emits zero diagnostics for that pair
    - **Validates: Requirements 3.1, 3.2**
  - [x] 6.3 Write property test: directive suppression (Property 7)
    - **Property 7: Directive suppression**
    - *For any* malformed operator pair on a line annotated with `@lsp-ignore` or targeted by `@lsp-ignore-next`, the analyzer emits zero diagnostics
    - **Validates: Requirements 7.1, 7.2**

- [x] 7. VS Code extension settings and documentation
  - [x] 7.1 Add `sight.diagnostics.severity.malformedOperator`, `sight.diagnostics.severity.invalidOperatorSequence`, and `sight.diagnostics.severity.cStyleLogicalInControlFlow` entries to `client/package.json` `contributes.configuration.properties`, following the existing severity setting pattern
    - _Requirements: 8.1, 8.2, 8.6, 8.7, 8.8, 8.9_
  - [x] 7.2 Add documentation rows to `README.md` diagnostics settings table for the three new severity settings
    - _Requirements: 8.1, 8.2, 8.8_

- [x] 8. Unit tests for exact messages and edge cases
  - [x] 8.1 Write unit tests in `tests/unit/operator-sequence-diagnostics.test.ts`
    - Test exact message strings for each suggestible pair (Requirements 5.4–5.8)
    - Test exact message strings for C-style logical pairs in qualifier context (Requirements 5.10–5.11)
    - Test exact message strings for C-style logical pairs in control flow context (Requirements 5.13–5.14)
    - Test exact message string for `| =` (Requirement 5.12)
    - Test exact message strings for general invalid pairs (Requirement 5.9)
    - Test diagnostic codes: `MALFORMED_OPERATOR === 6001`, `INVALID_OPERATOR_SEQUENCE === 6002`, `CSTYLE_LOGICAL_IN_CONTROL_FLOW === 6003` (Requirements 9.1–9.4)
    - Test default severity values in `DEFAULT_SETTINGS` (Requirements 8.6, 8.7, 8.9)
    - Test that comments between operators break adjacency
    - Test that compound operators without spaces produce single tokens (Requirement 4.2)
    - Test context detection: C-style logical in `if x { }` vs `gen y = 1 if x`
    - _Requirements: 4.2, 5.4–5.14, 8.6, 8.7, 8.9, 9.1–9.4_

- [x] 9. Integration tests
  - [x] 9.1 Write integration tests in `tests/integration/operator-sequence-diagnostics.test.ts`
    - Test that malformed operator diagnostics appear alongside other diagnostic types in the full `DiagnosticsProvider` pipeline
    - Test config changes propagate correctly
    - Test context-aware C-style logical handling in real code scenarios
    - _Requirements: 1.1–1.6, 2.1–2.7, 2a.1–2a.4, 3.1, 3.2, 8.1–8.10_

- [x] 10. Final checkpoint
  - Ensure all tests pass (`bun run test`), ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The lexer prerequisite (task 1) must be completed before the analyzer can correctly handle `~=`
- Property tests use `fast-check` (already in the project) with minimum 100 iterations
- Each property test is tagged: `Feature: malformed-operator-diagnostics, Property N: <title>`
- The `ignored_lines` exposure on `DocumentState` (task 2.5) is a prerequisite for directive suppression in the analyzer
- Context detection for C-style logical operators requires AST access to distinguish `if` control flow statements from `if` qualifiers
