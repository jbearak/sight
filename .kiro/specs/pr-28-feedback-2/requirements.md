# Requirements Document

## Introduction

This specification addresses critical issues identified in PR feedback related to test utility functions and parser semantic correctness. The issues include a broken `apply_edits` function that loses multiple text edits and incorrect usage of the `varlist` field for frame names in prefix parsing.

## Glossary

- **TextEdit**: LSP text edit object containing range and newText for document modifications
- **apply_edits**: Test utility function that applies multiple TextEdit objects to source text
- **PrefixNode**: AST node representing command prefixes (by, frame, etc.)
- **varlist**: Field in PrefixNode intended for variable lists in by-prefixes
- **frameName**: Proposed dedicated field for frame identifiers in frame prefixes

## Requirements

### Requirement 1: Fix apply_edits Function Bug

**User Story:** As a developer running property-based tests, I want the `apply_edits` function to correctly apply all text edits, so that multi-edit test scenarios produce accurate results.

#### Acceptance Criteria

1. WHEN `apply_edits` receives multiple TextEdit objects, THE System SHALL apply all edits to the source text
2. WHEN `apply_edits` receives zero edits, THE System SHALL return the original source unchanged
3. WHEN `apply_edits` receives one edit, THE System SHALL apply that single edit correctly
4. WHEN applying multiple edits with overlapping ranges, THE System SHALL handle them in the correct order to avoid index shifting issues
5. THE System SHALL preserve the existing early-return behavior for zero and single edit cases

### Requirement 2: Consolidate Duplicate apply_edits Functions

**User Story:** As a developer maintaining test code, I want a single shared `apply_edits` implementation, so that I don't have to fix the same bug in multiple places.

#### Acceptance Criteria

1. THE System SHALL provide a shared `apply_edits` function in the test helpers directory
2. WHEN test files need to apply text edits, THE System SHALL use the shared implementation
3. THE System SHALL remove duplicate `apply_edits` implementations from individual test files
4. THE System SHALL maintain backward compatibility for existing test usage patterns

### Requirement 3: Fix Frame Prefix Parsing Semantics

**User Story:** As a developer working with AST nodes, I want frame prefixes to use semantically correct fields, so that downstream code can distinguish between frame names and variable lists.

#### Acceptance Criteria

1. WHEN parsing frame prefixes, THE Parser SHALL store frame names in a dedicated `frameName` field
2. WHEN parsing frame prefixes, THE Parser SHALL leave the `varlist` field empty or undefined
3. WHEN parsing by-prefixes with variable lists, THE Parser SHALL continue using the `varlist` field
4. THE System SHALL update the PrefixNode type definition to include the `frameName` field
5. THE System SHALL update all callers that read frame names from prefix nodes

### Requirement 4: Extract Duplicate Test Utilities

**User Story:** As a developer writing tests, I want shared utility functions for common operations, so that I don't duplicate code across test files.

#### Acceptance Criteria

1. THE System SHALL provide a shared `find_command_nodes` function in test helpers
2. WHEN test files need to find command nodes in AST, THE System SHALL use the shared implementation
3. THE System SHALL remove duplicate `find_command_nodes` implementations from individual test files
4. THE System SHALL maintain consistent behavior across all test files using the utility

### Requirement 5: Fix Code Style Violations

**User Story:** As a developer following project coding standards, I want parameter names to follow snake_case convention, so that the codebase maintains consistency.

#### Acceptance Criteria

1. WHEN function parameters are defined, THE System SHALL use snake_case naming convention
2. THE System SHALL rename `startToken` parameter to `start_token` in parser functions
3. THE System SHALL rename `commandToken` parameter to `command_token` in parser functions
4. THE System SHALL rename local variables like `macroNameToken` to `macro_name_token`
5. THE System SHALL ensure all lines respect the 80-character limit specified in coding guidelines