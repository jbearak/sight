# Requirements Document

## Introduction

The formatter's `IndentationAnalyzer` class has a hardcoded `indent_size = 4` property (line 20 of `src/formatter/indentation-analyzer.ts`). This value is used in `calculate_indent_delta()` to compute the target indentation in spaces. However, the `SourcePreservingFormatter` receives the correct `indent_size` from the user's `tabSize` setting but doesn't pass it to the `IndentationAnalyzer`. This causes incorrect indentation deltas when users configure a tab size other than 4 (e.g., 2 spaces).

The `TokenReconstructor` correctly receives the config and generates proper indentation strings, but the `IndentationAnalyzer` calculates wrong deltas, leading to incorrect formatting especially for continuation lines where alignment preservation depends on accurate delta calculations.

## Glossary

- **IndentationAnalyzer**: Component that analyzes AST nodes and tokens to determine correct indentation levels and deltas for each line
- **FormatterConfig**: Configuration object containing `indent_size` and `indent_style` settings
- **indent_delta**: The difference between the target indentation (in spaces) and the original indentation; used to shift continuation lines by the same amount as their base statement
- **tabSize**: The number of spaces per indentation level, configured by the user in their editor settings

## Requirements

### Requirement 1: Pass indent_size to IndentationAnalyzer

**User Story:** As a developer, I want the formatter to respect my configured tab size, so that my code is indented consistently with my editor settings.

#### Acceptance Criteria

1. WHEN the SourcePreservingFormatter is constructed with a FormatterConfig, THE IndentationAnalyzer SHALL receive the indent_size from that config
2. WHEN the IndentationAnalyzer calculates indent_delta, THE IndentationAnalyzer SHALL use the configured indent_size instead of the hardcoded value of 4
3. FOR ALL valid tabSize values (1-8), formatting then re-formatting SHALL produce identical output (idempotency)

### Requirement 2: Correct Nested Block Indentation with Continuation Lines

**User Story:** As a developer, I want nested blocks with continuation lines in their conditions to be correctly indented, so that my code is readable and properly formatted.

#### Acceptance Criteria

1. WHEN an if block has a condition spanning multiple continuation lines AND tabSize is 2, THE Formatter SHALL correctly indent the block's body with 2 spaces per nesting level
2. WHEN blocks are nested two levels deep with tabSize 2, THE Formatter SHALL indent inner content with 4 spaces (2 levels × 2 spaces)
3. WHEN blocks are nested two levels deep with tabSize 4, THE Formatter SHALL indent inner content with 8 spaces (2 levels × 4 spaces)
4. WHEN a block's opening brace appears on a continuation line, THE Formatter SHALL still correctly identify the block depth for body indentation
