# Requirements Document

## Introduction

This feature ensures that all formatter tests are executed against both formatter implementations in the Sight LSP: the `SourcePreservingFormatter` (default, source-preserving mode) and the `PrettyPrinter` (AST-based mode). Currently, formatter tests primarily exercise the default source-preserving formatter, leaving the AST-based formatter with less coverage. By running the same test suite against both formatters, we can ensure consistent behavior and catch regressions in either implementation.

## Glossary

- **Source_Preserving_Formatter**: The default formatter that reconstructs source code from tokens while preserving original structure and whitespace patterns. Uses `SourcePreservingFormatter` class.
- **AST_Formatter**: The experimental formatter that reconstructs source code from the Abstract Syntax Tree. Uses `PrettyPrinter` class.
- **Code_Formatter**: The LSP provider (`CodeFormatter` class) that delegates to either formatter based on configuration mode.
- **Formatter_Mode**: Configuration setting (`'source-preserving'` or `'ast'`) that determines which formatter implementation is used.
- **Test_Suite**: The collection of property-based and unit tests for formatter functionality.

## Requirements

### Requirement 1: Dual Formatter Test Execution

**User Story:** As a developer, I want formatter tests to run against both formatter implementations, so that I can ensure consistent behavior across both modes.

#### Acceptance Criteria

1. WHEN a formatter property test is executed, THE Test_Suite SHALL run the test against both Source_Preserving_Formatter and AST_Formatter
2. WHEN a formatter test fails for one mode but passes for another, THE Test_Suite SHALL clearly indicate which Formatter_Mode failed
3. THE Test_Suite SHALL provide a mechanism to parameterize tests across both formatter modes

### Requirement 2: Test Infrastructure for Dual Execution

**User Story:** As a developer, I want a reusable test helper that runs formatter tests against both modes, so that I can easily add dual-mode coverage to existing and new tests.

#### Acceptance Criteria

1. THE Test_Suite SHALL provide a helper function that accepts a test function and executes it for both formatter modes
2. WHEN the helper function is used, THE Test_Suite SHALL create appropriate configuration for each Formatter_Mode
3. THE Test_Suite SHALL support both property-based tests and unit tests with the dual-mode helper

### Requirement 3: Existing Test Migration

**User Story:** As a developer, I want existing formatter tests to be updated to use dual-mode execution, so that both formatters receive equal test coverage.

#### Acceptance Criteria

1. WHEN existing formatter property tests are migrated, THE Test_Suite SHALL preserve all existing test assertions
2. THE Test_Suite SHALL migrate the following test files to dual-mode execution:
   - `formatter-mode.prop.test.ts`
   - `formatter-indentation.prop.test.ts`
   - `formatter-source-preservation.prop.test.ts`
   - `formatter-comment-preservation.prop.test.ts`
   - `formatter-comment-normalization.prop.test.ts`
   - `formatter-embedded-context.prop.test.ts`
   - `formatting-preservation.prop.test.ts`
3. IF a test is mode-specific (e.g., testing mode selection itself), THEN THE Test_Suite SHALL exclude it from dual-mode execution

### Requirement 4: Mode-Specific Behavior Documentation

**User Story:** As a developer, I want tests to document expected behavioral differences between formatters, so that I understand when different outputs are acceptable.

#### Acceptance Criteria

1. WHEN the AST_Formatter produces different but valid output compared to Source_Preserving_Formatter, THE Test_Suite SHALL allow mode-specific assertions
2. THE Test_Suite SHALL provide a mechanism to skip specific assertions for a particular Formatter_Mode when behavior legitimately differs
3. THE Test_Suite SHALL document any known behavioral differences between formatter modes in test comments

### Requirement 5: Test Output Clarity

**User Story:** As a developer, I want clear test output that identifies which formatter mode failed, so that I can quickly diagnose issues.

#### Acceptance Criteria

1. WHEN a test fails, THE Test_Suite SHALL include the Formatter_Mode in the failure message
2. WHEN running dual-mode tests, THE Test_Suite SHALL use descriptive test names that include the mode (e.g., "Property X [source-preserving]", "Property X [ast]")
3. THE Test_Suite SHALL report pass/fail status separately for each Formatter_Mode

### Requirement 6: Developer Documentation

**User Story:** As a developer, I want AGENTS.md to document the dual-formatter architecture and testing requirements, so that future contributors know to add tests for both formatters.

#### Acceptance Criteria

1. THE AGENTS.md file SHALL document that Sight has two formatter implementations (Source_Preserving_Formatter and AST_Formatter)
2. THE AGENTS.md file SHALL specify that new formatter tests MUST use the dual-mode test helper to run against both formatters
3. THE AGENTS.md file SHALL reference the location of the dual-mode test helper utilities
