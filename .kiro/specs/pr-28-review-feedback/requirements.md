# Requirements Document

## Introduction

This spec addresses all review feedback from PR #28 (AST formatter prefix command handling). The PR introduced frame-prefixed command support and brace block formatting, but reviewers identified several issues that need to be resolved before merging.

## Glossary

- **Parser**: Component that converts tokens into an Abstract Syntax Tree (AST)
- **Pretty_Printer**: Component that converts AST back into formatted source code
- **Formatter**: High-level component that orchestrates formatting (two modes: AST and source-preserving)
- **Varlist**: List of variable names in Stata commands
- **Wildcard_Operator**: The `*` and `?` characters used in Stata variable patterns
- **Frame_Prefix**: The `frame name:` syntax that prefixes commands
- **Property_Test**: Test that validates properties across many generated inputs
- **Dual_Formatter_Testing**: Running tests against both AST and source-preserving formatter modes

## Requirements

### Requirement 1: Wildcard Operator Parsing in Frame-Prefixed Commands

**User Story:** As a developer, I want wildcard operators to be preserved in frame-prefixed commands, so that patterns like `frame myframe: summarize var*` format correctly.

#### Acceptance Criteria

1. WHEN parseCommandBody encounters an OPERATOR token with value `*` or `?` THEN the system SHALL treat it as a varlist item
2. WHEN a wildcard operator appears in a frame-prefixed command THEN the system SHALL preserve it in the varlist
3. WHEN formatting a frame-prefixed command with wildcards THEN the system SHALL output the wildcards in their original positions
4. WHEN parseCommandBody processes varlists THEN the system SHALL use the same wildcard detection logic as parseCommand

### Requirement 2: Dual Formatter Test Coverage

**User Story:** As a developer, I want formatter tests to run against both formatter implementations, so that I can ensure both formatters handle code correctly.

#### Acceptance Criteria

1. WHEN running formatter tests THEN the system SHALL execute tests in both AST and source-preserving modes using `for_each_formatter_mode_property()`
2. WHEN both formatters should handle a feature THEN the system SHALL run the test in both modes
3. WHEN only the AST formatter normalizes a specific aspect THEN the system SHALL use `skip_for_mode('source-preserving')` for that test
4. WHEN a formatter test fails in one mode THEN the system SHALL report which mode failed
5. WHEN adding new formatter tests THEN the system SHALL use the dual-mode test helpers from `tests/property/helpers/formatter-test-utils.ts`

### Requirement 3: Reserved Identifier Handling in Tests

**User Story:** As a developer, I want property tests to avoid reserved keywords in varlist positions, so that tests don't produce misleading failures.

#### Acceptance Criteria

1. WHEN generating identifiers for varlist positions THEN the system SHALL use `arbitrary_non_reserved_identifier()`
2. WHEN generating macro names in tests THEN the system SHALL exclude reserved keywords like `if`, `in`, and `by`
3. WHEN a test needs identifiers for expression contexts THEN the system SHALL use the shared generator from `tests/property/generators/index.ts`

### Requirement 4: Frame Prefix Parsing Code Deduplication

**User Story:** As a developer, I want frame prefix parsing logic to be centralized, so that I can maintain consistent behavior and reduce code duplication.

#### Acceptance Criteria

1. WHEN parseCommand encounters a frame prefix THEN the system SHALL use shared frame prefix parsing logic
2. WHEN parseFrameBlock encounters a frame prefix THEN the system SHALL use the same shared frame prefix parsing logic
3. WHEN frame prefix parsing logic changes THEN the system SHALL only require updates in one location
4. WHEN extracting shared logic THEN the system SHALL preserve existing behavior for both entry points

### Requirement 5: AST Structure Refactoring for Colon Handling

**User Story:** As a developer, I want colons to be represented as dedicated AST fields rather than mixed into varlists, so that the AST maintains clean separation between syntax and semantics.

#### Acceptance Criteria

1. WHEN the parser encounters a colon in `unab` commands THEN the system SHALL store it in a dedicated field rather than in the varlist
2. WHEN the AST represents prefix commands THEN the system SHALL use the existing `has_colon` field on PrefixNode
3. WHEN downstream consumers access varlists THEN the system SHALL receive only variable names, not syntax tokens
4. WHEN the pretty printer formats commands with colons THEN the system SHALL reconstruct colons from dedicated fields
5. WHEN the AST structure changes THEN the system SHALL maintain backward compatibility for existing consumers

### Requirement 6: Pretty Printer Logic Simplification

**User Story:** As a developer, I want the pretty printer to use clear, maintainable logic, so that future changes don't introduce bugs.

#### Acceptance Criteria

1. WHEN formatting prefix command brace blocks THEN the system SHALL determine the correct format upfront rather than manipulating arrays after construction
2. WHEN the pretty printer builds output THEN the system SHALL avoid fragile assumptions about array structure
3. WHEN complex logic is necessary THEN the system SHALL include comments explaining the expected state
4. WHEN refactoring array manipulation THEN the system SHALL replace it with upfront format determination
5. WHEN the pretty printer processes prefix commands THEN the system SHALL use a clear decision tree rather than post-hoc array manipulation

### Requirement 7: Test Generator Consistency

**User Story:** As a developer, I want test generators to use consistent patterns, so that tests are maintainable and reliable.

#### Acceptance Criteria

1. WHEN tests filter identifiers manually THEN the system SHALL replace manual filters with `arbitrary_non_reserved_identifier()`
2. WHEN tests generate variable names THEN the system SHALL use the shared generator infrastructure
3. WHEN adding new property tests THEN the system SHALL follow the established generator patterns
4. WHEN generators are updated THEN the system SHALL apply changes consistently across all tests

### Requirement 8: Semantic Test Coverage

**User Story:** As a developer, I want tests that validate AST structure integrity, so that downstream consumers can rely on consistent AST shapes.

#### Acceptance Criteria

1. WHEN running tests THEN the system SHALL validate that varlists contain expected token types
2. WHEN testing frame-prefixed commands THEN the system SHALL verify AST node structure matches expectations
3. WHEN testing wildcard operators THEN the system SHALL confirm they appear in the correct AST locations
4. WHEN AST structure changes THEN the system SHALL detect breaking changes through semantic tests

### Requirement 9: Code Comment Quality

**User Story:** As a developer, I want clear comments explaining complex logic, so that I can understand and maintain the code.

#### Acceptance Criteria

1. WHEN complex array manipulation occurs THEN the system SHALL include comments explaining the expected state
2. WHEN frame prefix parsing logic executes THEN the system SHALL document the parsing strategy
3. WHEN wildcard detection logic runs THEN the system SHALL explain why specific token types are checked
4. WHEN formatting decisions are made THEN the system SHALL document the reasoning

### Requirement 10: Regression Prevention

**User Story:** As a developer, I want comprehensive test coverage, so that future changes don't break existing functionality.

#### Acceptance Criteria

1. WHEN wildcard operators are parsed THEN the system SHALL have property tests covering all wildcard patterns
2. WHEN frame-prefixed commands are formatted THEN the system SHALL have tests for all prefix combinations
3. WHEN brace blocks are formatted THEN the system SHALL have tests for nested and standalone blocks
4. WHEN tests are added THEN the system SHALL cover both happy paths and edge cases

### Requirement 11: Dedicated Colon Field in CommandNode

**User Story:** As a developer, I want `unab` commands to store colons in a dedicated field, so that varlists contain only variable names.

#### Acceptance Criteria

1. WHEN the CommandNode type is extended THEN the system SHALL add an optional `has_colon_before_varlist?: boolean` field
2. WHEN parsing `unab macroname: varlist` THEN the system SHALL set `has_colon_before_varlist = true` and exclude the colon from the varlist
3. WHEN the pretty printer formats `unab` commands THEN the system SHALL check `has_colon_before_varlist` to determine whether to emit a colon
4. WHEN other commands use colons THEN the system SHALL continue using the existing `has_colon` field on PrefixNode
5. WHEN the AST is serialized THEN the system SHALL include the new field in the output

