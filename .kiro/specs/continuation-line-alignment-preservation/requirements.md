# Requirements Document

## Introduction

This feature enhances the Stata formatter to detect and preserve intentional alignment in continuation lines. When users carefully align operators, conditions, or other code elements across continuation lines for readability, the formatter should recognize this purposeful formatting and preserve it rather than reformatting it into a standard indentation pattern.

## Glossary

- **Continuation_Line**: A line that continues a statement from the previous line, indicated by `///` at the end of the preceding line
- **Intentional_Alignment**: User-applied formatting where code elements (operators, conditions, keywords) are vertically aligned across multiple lines for readability
- **Alignment_Anchor**: A character or token position that serves as the reference point for alignment (e.g., the position after `if ` in conditional statements)
- **Source_Preserving_Formatter**: The default formatter mode that preserves original source structure while applying indentation
- **AST_Formatter**: The alternative formatter mode that rebuilds code from the Abstract Syntax Tree
- **Alignment_Pattern**: A detected pattern of vertical alignment across continuation lines (e.g., aligned operators, aligned conditions)

## Requirements

### Requirement 1: Detect Aligned Operators in Continuation Lines

**User Story:** As a Stata developer, I want the formatter to detect when I have aligned operators across continuation lines, so that my intentional formatting for readability is preserved.

#### Acceptance Criteria

1. WHEN a continuation line contains operators (`&`, `|`, `+`, `-`, `*`, `/`, `==`, `!=`, `<`, `>`, `<=`, `>=`) at the exact same column position as the previous line, THE Formatter SHALL recognize this as intentional alignment
2. WHEN the formatter detects aligned operators across two or more consecutive continuation lines, THE Formatter SHALL preserve the original column positions of those operators
3. WHEN only some operators in a continuation sequence are aligned (partial alignment), THE Formatter SHALL preserve the alignment for those that are aligned and preserve the original positions for those that are not
4. THE Formatter SHALL preserve the user's original whitespace and column positions for all continuation lines, regardless of whether full alignment was achieved

### Requirement 2: Detect Aligned Conditional Expressions

**User Story:** As a Stata developer, I want the formatter to detect when I have aligned conditional expressions after `if`, so that complex conditions remain readable.

#### Acceptance Criteria

1. WHEN continuation lines following an `if` qualifier have conditions aligned to start at the same column, THE Formatter SHALL recognize this as intentional alignment
2. WHEN the formatter detects that conditions are aligned to the position after `if `, THE Formatter SHALL preserve this alignment pattern
3. WHEN a user aligns conditions to any consistent column position across continuation lines, THE Formatter SHALL preserve that alignment
4. IF continuation lines have inconsistent alignment (varying column positions), THEN THE Formatter SHALL apply standard continuation indentation

### Requirement 3: Preserve Alignment in Source-Preserving Formatter

**User Story:** As a Stata developer using the source-preserving formatter, I want my intentional alignments preserved, so that I can maintain readable code formatting.

#### Acceptance Criteria

1. WHEN the source-preserving formatter processes a file with aligned continuation lines, THE Formatter SHALL detect alignment patterns before applying indentation
2. WHEN an alignment pattern is detected, THE Formatter SHALL skip indentation adjustment for those continuation lines
3. WHEN no alignment pattern is detected, THE Formatter SHALL apply standard continuation indentation (base indent + 1 level)
4. THE Formatter SHALL preserve the exact whitespace on aligned continuation lines

### Requirement 4: Preserve Alignment in AST Formatter

**User Story:** As a Stata developer using the AST formatter, I want my intentional alignments preserved, so that reformatting doesn't destroy my carefully structured code.

#### Acceptance Criteria

1. WHEN the AST formatter reconstructs code with continuation lines, THE Pretty_Printer SHALL check for alignment patterns in the original source
2. WHEN an alignment pattern is detected in the original source, THE Pretty_Printer SHALL reproduce that alignment in the output
3. WHEN no alignment pattern is detected, THE Pretty_Printer SHALL apply standard continuation formatting
4. THE Pretty_Printer SHALL use the original source positions as reference for alignment detection

### Requirement 5: Handle Mixed Alignment Scenarios

**User Story:** As a Stata developer, I want the formatter to handle files with both aligned and non-aligned continuation lines correctly, so that each section is formatted appropriately.

#### Acceptance Criteria

1. WHEN a file contains multiple statements with continuation lines, THE Formatter SHALL analyze each statement's continuation lines independently
2. WHEN one statement has aligned continuation lines and another does not, THE Formatter SHALL preserve alignment for the first and apply standard indentation to the second
3. WHEN a single statement has some aligned continuation lines and some non-aligned, THE Formatter SHALL preserve alignment only for the aligned portions
4. THE Formatter SHALL not propagate alignment detection from one statement to another

### Requirement 6: Alignment Detection Configuration

**User Story:** As a Stata developer, I want to configure alignment preservation behavior, so that I can control how the formatter handles my code.

#### Acceptance Criteria

1. THE Formatter SHALL provide a configuration option `formatting.preserveAlignment` (default: `true`)
2. WHEN `formatting.preserveAlignment` is `true`, THE Formatter SHALL detect and preserve intentional alignments
3. WHEN `formatting.preserveAlignment` is `false`, THE Formatter SHALL apply standard continuation indentation regardless of existing alignment
4. THE Configuration SHALL be readable from `.sight.json` workspace configuration file

### Requirement 7: Documentation

**User Story:** As a Stata developer, I want to understand the alignment preservation feature, so that I can use it effectively.

#### Acceptance Criteria

1. THE README.md SHALL document the `formatting.preserveAlignment` configuration option
2. THE README.md SHALL include examples of aligned continuation lines that will be preserved
3. THE README.md SHALL explain the behavior when alignment preservation is enabled vs disabled

### Requirement 8: AST Bug Fixes

**User Story:** As a developer implementing this feature, I want to fix any AST bugs that block alignment preservation, so that the feature works correctly.

#### Acceptance Criteria

1. IF an AST bug is discovered that prevents correct alignment detection or preservation, THEN THE implementation SHALL fix the AST bug rather than work around it
2. THE implementation SHALL NOT modify tests to make them pass when the underlying code is incorrect
3. WHEN fixing AST bugs, THE implementation SHALL ensure existing tests continue to pass
