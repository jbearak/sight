# Requirements Document

## Introduction

This document specifies requirements for fixing two related bugs in the indentation diagnostic and formatter systems when handling mixed tabs and spaces:

1. **False positive diagnostics**: The indentation diagnostic analyzer incorrectly reports "Line appears unnecessarily indented" when a line uses mixed tabs and spaces that produce the same visual width as the expected indentation.

2. **Formatter not normalizing**: The formatter fails to normalize mixed tabs/spaces to consistent indentation (all spaces when `indent_style: spaces`), leaving the diagnostic unfixed even after "Format Document".

## Glossary

- **Indentation_Diagnostic_Analyzer**: The component that detects indentation issues and emits warnings/info diagnostics
- **Source_Preserving_Formatter**: The formatter that preserves source structure while applying indentation corrections
- **Token_Reconstructor**: The component that reconstructs source code from tokens with indentation adjustments
- **Visual_Width**: The column position where content appears, accounting for tab expansion (tabs expand to next tab stop)
- **Indent_Size**: The number of spaces per indentation level (typically 4)
- **Mixed_Whitespace**: Leading whitespace containing both space and tab characters

## Requirements

### Requirement 1: Correct Visual Width Comparison in Diagnostics

**User Story:** As a developer, I want the indentation diagnostic to correctly identify unnecessary indentation, so that I don't receive false positive warnings when my code uses mixed tabs and spaces that produce correct visual alignment.

#### Acceptance Criteria

1. WHEN a line has leading whitespace with mixed tabs and spaces, THE Indentation_Diagnostic_Analyzer SHALL compute the visual width by expanding tabs to the next tab stop (multiples of indent_size)
2. WHEN the visual width of a line's indentation equals the expected indentation (depth × indent_size), THE Indentation_Diagnostic_Analyzer SHALL NOT emit an unnecessary indentation diagnostic
3. WHEN the visual width of a line's indentation exceeds the expected indentation, THE Indentation_Diagnostic_Analyzer SHALL emit an unnecessary indentation diagnostic
4. IF a line uses space followed by tab (e.g., " \t") that produces visual width equal to expected indentation, THEN THE Indentation_Diagnostic_Analyzer SHALL NOT emit a diagnostic

### Requirement 2: Formatter Normalizes Mixed Whitespace

**User Story:** As a developer, I want the formatter to normalize mixed tabs and spaces to consistent indentation, so that "Format Document" fixes indentation style inconsistencies.

#### Acceptance Criteria

1. WHEN formatting a line with mixed tabs and spaces at the start, THE Source_Preserving_Formatter SHALL replace the mixed whitespace with consistent indentation
2. WHEN indent_style is "spaces", THE Token_Reconstructor SHALL convert all leading tabs to spaces
3. WHEN indent_style is "tabs", THE Token_Reconstructor SHALL convert leading spaces to tabs where possible
4. WHEN a line has correct visual indentation but uses mixed whitespace, THE Source_Preserving_Formatter SHALL normalize the whitespace while preserving the visual indentation level

### Requirement 3: Diagnostic and Formatter Consistency

**User Story:** As a developer, I want the diagnostic and formatter to be consistent, so that running "Format Document" fixes all reported indentation issues.

#### Acceptance Criteria

1. FOR ALL lines where the Indentation_Diagnostic_Analyzer emits an unnecessary indentation diagnostic, THE Source_Preserving_Formatter SHALL produce output that resolves the diagnostic
2. FOR ALL lines where the Indentation_Diagnostic_Analyzer emits a missing indentation diagnostic, THE Source_Preserving_Formatter SHALL produce output that resolves the diagnostic
3. WHEN the formatter normalizes mixed whitespace, THE resulting code SHALL NOT trigger new indentation diagnostics
