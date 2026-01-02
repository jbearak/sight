---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - stata-lsp: [Core dependency]
Status: Active
Related Specs:
  - restore-test-regime: [Related diagnostics spec]
  - large-file-indexing-policy: [Related diagnostics spec]
  - quote-auto-delete-simplification: [Related diagnostics spec]
---

# Requirements Document

## Introduction

This specification defines a comment style normalization feature for the Stata LSP. The feature allows users to optionally normalize comment styles in their Stata code to a preferred format during document formatting operations. This is a non-intrusive, opt-in feature that respects existing code by default and only applies changes when explicitly requested by the user.

## Glossary

- **Comment Style**: The syntax used to denote comments in Stata code (`*`, `//`, or `/* */`)
- **Normalization**: The process of converting comments from one style to another
- **Format Document**: An LSP operation that reformats code according to user preferences
- **Formatter**: The LSP component responsible for code formatting operations
- **Configuration**: User-specified settings that control LSP behavior

## Requirements

### Requirement 1: Comment Style Configuration

**User Story:** As a Stata developer, I want to configure my preferred comment style, so that the LSP knows which style to use when normalizing comments.

#### Acceptance Criteria

1. THE Configuration SHALL support a `formatting.preferredCommentStyle` setting
2. THE Configuration SHALL accept three valid values: `"//"`, `"*"`, or `"/* */"`
3. THE Configuration SHALL default to `"//"` when not explicitly set
4. WHEN an invalid comment style is provided, THE Configuration SHALL fall back to the default value
5. THE Configuration SHALL be accessible to all formatting operations

### Requirement 2: Optional Comment Normalization

**User Story:** As a Stata developer, I want comment normalization to be optional, so that my existing code is not modified without my explicit consent.

#### Acceptance Criteria

1. THE Configuration SHALL support a `formatting.normalizeCommentStyle` boolean setting
2. THE Configuration SHALL default to `false` (normalization disabled)
3. WHEN `normalizeCommentStyle` is `false`, THE Formatter SHALL preserve all existing comment styles
4. WHEN `normalizeCommentStyle` is `true`, THE Formatter SHALL normalize comments to the preferred style
5. THE Formatter SHALL only normalize comments during explicit format operations

### Requirement 3: Comment Style Detection

**User Story:** As a developer, I want the formatter to correctly identify different comment styles, so that normalization works accurately.

#### Acceptance Criteria

1. THE Formatter SHALL detect line comments starting with `*` (star comments)
2. THE Formatter SHALL detect line comments starting with `//` (slash comments)
3. THE Formatter SHALL detect block comments enclosed in `/* */`
4. THE Formatter SHALL detect continuation comments starting with `///`
5. THE Formatter SHALL NOT treat comments inside strings as actual comments
6. THE Formatter SHALL preserve comment content during style conversion

### Requirement 4: Comment Normalization Logic

**User Story:** As a developer, I want comments to be normalized consistently, so that my code has a uniform style.

#### Acceptance Criteria

1. WHEN normalizing to `"//"` style, THE Formatter SHALL convert `*` comments to `//` comments
2. WHEN normalizing to `"//"` style, THE Formatter SHALL convert `/* */` comments to `//` comments
3. WHEN normalizing to `"*"` style, THE Formatter SHALL convert `//` comments to `*` comments
4. WHEN normalizing to `"*"` style, THE Formatter SHALL convert `/* */` comments to `*` comments
5. WHEN normalizing to `"/* */"` style, THE Formatter SHALL convert `*` and `//` comments to `/* */` format
6. THE Formatter SHALL preserve leading whitespace before comments
7. THE Formatter SHALL preserve the comment text content exactly
8. THE Formatter SHALL NOT normalize continuation comments (`///`)

### Requirement 5: Multi-line Comment Handling

**User Story:** As a developer, I want multi-line block comments to be handled appropriately, so that comment structure is preserved.

#### Acceptance Criteria

1. WHEN normalizing a multi-line `/* */` comment to `//` style, THE Formatter SHALL create multiple `//` comment lines
2. WHEN normalizing a multi-line `/* */` comment to `*` style, THE Formatter SHALL create multiple `*` comment lines
3. WHEN normalizing multiple consecutive single-line comments to `/* */` style, THE Formatter SHALL combine them into a single block comment
4. THE Formatter SHALL preserve blank lines within multi-line comments
5. THE Formatter SHALL maintain proper indentation for multi-line comments

### Requirement 6: Comment Toggle Integration

**User Story:** As a developer, I want the comment toggle command to use my preferred style, so that new comments match my preferences.

#### Acceptance Criteria

1. WHEN the user toggles a line comment, THE LSP SHALL use the configured `preferredCommentStyle`
2. WHEN `preferredCommentStyle` is `"//"`, THE LSP SHALL add `//` when commenting lines
3. WHEN `preferredCommentStyle` is `"*"`, THE LSP SHALL add `*` when commenting lines
4. WHEN `preferredCommentStyle` is `"/* */"`, THE LSP SHALL add `/* */` when commenting lines
5. THE LSP SHALL correctly uncomment lines regardless of the original comment style

### Requirement 7: Code Generation Integration

**User Story:** As a developer, I want generated code snippets to use my preferred comment style, so that generated code matches my coding standards.

#### Acceptance Criteria

1. WHEN generating program templates, THE LSP SHALL use the configured `preferredCommentStyle`
2. WHEN generating function documentation, THE LSP SHALL use the configured `preferredCommentStyle`
3. WHEN generating TODO comments, THE LSP SHALL use the configured `preferredCommentStyle`
4. THE LSP SHALL apply the preferred style to all auto-generated comments

### Requirement 8: Format on Save Integration

**User Story:** As a developer, I want to optionally normalize comments when saving files, so that my code stays consistent automatically.

#### Acceptance Criteria

1. THE Configuration SHALL support a `formatting.normalizeOnSave` boolean setting
2. THE Configuration SHALL default to `false` (no automatic normalization)
3. WHEN `normalizeOnSave` is `true` AND `normalizeCommentStyle` is `true`, THE Formatter SHALL normalize comments on save
4. WHEN `normalizeOnSave` is `false`, THE Formatter SHALL NOT normalize comments on save
5. THE Formatter SHALL respect VS Code's `editor.formatOnSave` setting

### Requirement 9: Embedded Language Context Awareness

**User Story:** As a developer, I want comment normalization to respect embedded language contexts, so that Mata and Python comments are not incorrectly modified.

#### Acceptance Criteria

1. THE Formatter SHALL NOT normalize comments inside Mata blocks
2. THE Formatter SHALL NOT normalize comments inside Python blocks
3. THE Formatter SHALL only normalize comments in Stata language context
4. THE Formatter SHALL preserve embedded language comment syntax
5. THE Formatter SHALL correctly identify language context boundaries

### Requirement 10: Performance and Safety

**User Story:** As a developer, I want comment normalization to be fast and safe, so that it doesn't slow down my workflow or corrupt my code.

#### Acceptance Criteria

1. THE Formatter SHALL normalize comments in under 100ms for files up to 10,000 lines
2. THE Formatter SHALL preserve all non-comment code exactly
3. THE Formatter SHALL maintain correct line and column positions
4. THE Formatter SHALL handle edge cases without errors (empty comments, special characters)
5. THE Formatter SHALL be reversible (users can undo normalization)

### Requirement 11: Configuration Validation

**User Story:** As a developer, I want invalid configuration values to be handled gracefully, so that my LSP doesn't break due to configuration errors.

#### Acceptance Criteria

1. WHEN an invalid `preferredCommentStyle` is provided, THE LSP SHALL log a warning
2. WHEN an invalid `preferredCommentStyle` is provided, THE LSP SHALL use the default value
3. WHEN configuration is missing, THE LSP SHALL use default values
4. THE LSP SHALL validate configuration on startup and on configuration changes
5. THE LSP SHALL provide clear error messages for invalid configuration

### Requirement 12: Comment Line Length Normalization

**User Story:** As a developer, I want to normalize comment line lengths to a specified width, so that my comments are consistently formatted and readable.

#### Acceptance Criteria

1. THE Configuration SHALL support a `formatting.commentLineWidth` numeric setting
2. THE Configuration SHALL default to 72 characters when not explicitly set
3. WHEN normalizing comments, THE Formatter SHALL wrap long comment lines to the specified width
4. THE Formatter SHALL preserve word boundaries when wrapping comments
5. THE Formatter SHALL maintain proper indentation for wrapped comment lines
6. THE Formatter SHALL NOT wrap comments shorter than the specified width
7. THE Formatter SHALL handle both single-line and multi-line comment wrapping
8. THE Formatter SHALL understand basic Markdown syntax in comments
9. THE Formatter SHALL NOT break Markdown list items across lines during wrapping
10. THE Formatter SHALL preserve Markdown formatting elements (headers, lists, code blocks)
11. THE Formatter SHALL respect Markdown line break semantics

### Requirement 13: User Documentation

**User Story:** As a developer, I want clear documentation on comment normalization, so that I understand how to use this feature.

#### Acceptance Criteria

1. THE Documentation SHALL explain all comment style configuration options
2. THE Documentation SHALL provide examples of each comment style
3. THE Documentation SHALL explain when normalization occurs
4. THE Documentation SHALL include before/after examples
5. THE Documentation SHALL explain how to enable/disable normalization
6. THE Documentation SHALL document comment line width configuration
