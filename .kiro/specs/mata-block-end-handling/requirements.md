# Requirements Document

## Introduction

This document specifies requirements for fixing bugs in the handling of Mata/Python embedded language blocks:

1. **Indentation Diagnostic False Positive**: The LSP incorrectly flags the `end` statement of a Mata block as "unnecessarily indented" when it's correctly aligned with the `mata` keyword.

2. **Formatter Code Deletion (Multi-line blocks)**: When formatting a document with a multi-line Mata block, the formatter deletes the `end` statement and all code following it.

3. **Formatter Code Deletion (Single-line calls)**: When formatting a document with a single-line `mata:` or `python:` call, the formatter deletes all code following the embedded call due to improper range handling.

Bugs 1 and 2 stem from context ranges excluding the `end` delimiter line. Bug 3 stems from using `MAX_SAFE_INTEGER` as the end character position without clamping to actual line length.

## Glossary

- **Mata_Block**: An embedded Mata language block starting with `mata` and ending with `end`
- **Mata_Inline**: A single-line Mata call using `mata:` syntax (e.g., `mata: function()`)
- **Context_Range**: A range object tracking the language context (Stata, Mata, Python) for a section of code
- **End_Delimiter**: The `end` statement that closes a Mata or Python block
- **Expected_Depths**: A map from line numbers to expected indentation depths computed from the AST
- **Embedded_Block_Node**: An AST node of type `embedded_block` representing a Mata or Python block
- **IndentationDiagnosticAnalyzer**: The component that detects indentation issues
- **CodeFormatter**: The component that formats Stata code

## Requirements

### Requirement 1: Indentation Diagnostic Accuracy for End Delimiters

**User Story:** As a developer, I want the LSP to correctly recognize that `end` statements closing Mata/Python blocks are properly indented, so that I don't receive false positive warnings.

#### Acceptance Criteria

1. WHEN an `end` statement closes a Mata block AND the `end` is indented at the same level as the `mata` keyword, THE IndentationDiagnosticAnalyzer SHALL NOT emit an unnecessary indentation diagnostic for that line
2. WHEN an `end` statement closes a Python block AND the `end` is indented at the same level as the `python` keyword, THE IndentationDiagnosticAnalyzer SHALL NOT emit an unnecessary indentation diagnostic for that line
3. WHEN computing expected depths, THE IndentationDiagnosticAnalyzer SHALL include the end delimiter line of embedded blocks at the same depth as the start delimiter
4. THE IndentationDiagnosticAnalyzer SHALL recognize `embedded_block` AST nodes and compute correct depths for their start and end lines

### Requirement 2: Formatter Preservation of End Delimiters

**User Story:** As a developer, I want the formatter to preserve the `end` statement and all code following a Mata/Python block, so that formatting doesn't corrupt my code.

#### Acceptance Criteria

1. WHEN formatting a document containing a Mata block, THE CodeFormatter SHALL preserve the `end` statement that closes the block
2. WHEN formatting a document containing a Mata block, THE CodeFormatter SHALL preserve all code following the `end` statement
3. WHEN extracting embedded block content for placeholder replacement, THE CodeFormatter SHALL include the end delimiter line in the extracted content
4. WHEN formatting a document containing a Python block, THE CodeFormatter SHALL preserve the `end` statement and all following code
5. FOR ALL valid Stata documents containing Mata or Python blocks, formatting SHALL produce output that contains all original statements (round-trip preservation)

### Requirement 3: Context Range Consistency

**User Story:** As a developer, I want consistent handling of embedded block boundaries across all LSP components, so that features work correctly together.

#### Acceptance Criteria

1. WHEN the context range for a Mata block ends at line N, THE CodeFormatter SHALL extract content from the start line through line N+1 (including the end delimiter)
2. WHEN the context range for a Python block ends at line N, THE CodeFormatter SHALL extract content from the start line through line N+1 (including the end delimiter)
3. THE IndentationDiagnosticAnalyzer SHALL use AST node ranges (which include the end delimiter) rather than context ranges (which exclude it) for depth computation

### Requirement 4: Formatter Indentation Analyzer Embedded Block Recognition

**User Story:** As a developer, I want the formatter to correctly recognize Mata/Python blocks as block structures, so that the opening delimiter is not incorrectly indented.

#### Acceptance Criteria

1. WHEN formatting a document containing a Mata block, THE IndentationAnalyzer SHALL recognize `embedded_block` AST nodes as block structures
2. WHEN computing indentation for a Mata block, THE IndentationAnalyzer SHALL set the start line (`mata`) at the current depth without adding extra indentation
3. WHEN computing indentation for a Mata block, THE IndentationAnalyzer SHALL set the end line (`end`) at the same depth as the start line
4. THE IndentationAnalyzer SHALL NOT recurse into embedded block content (it's a different language)
5. WHEN formatting a document containing a Python block, THE IndentationAnalyzer SHALL apply the same rules as for Mata blocks

### Requirement 5: Formatter Preservation of Single-Line Embedded Calls

**User Story:** As a developer, I want the formatter to preserve all code following single-line `mata:` or `python:` calls, so that formatting doesn't corrupt my code.

#### Acceptance Criteria

1. WHEN formatting a document containing a single-line `mata:` call, THE CodeFormatter SHALL preserve all code following the call
2. WHEN formatting a document containing a single-line `python:` call, THE CodeFormatter SHALL preserve all code following the call
3. WHEN replacing a range in content, THE CodeFormatter SHALL clamp the end character position to the actual line length to prevent overflow
4. FOR ALL valid Stata documents containing single-line `mata:` or `python:` calls, formatting SHALL produce output that contains all original statements
