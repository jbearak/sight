# Requirements Document

## Introduction

This document specifies requirements for fixing two related bugs in the handling of Mata block `end` statements:

1. **Indentation Diagnostic False Positive**: The LSP incorrectly flags the `end` statement of a Mata block as "unnecessarily indented" when it's correctly aligned with the `mata` keyword.

2. **Formatter Code Deletion**: When formatting a document with a Mata block, the formatter deletes the `end` statement and all code following it.

Both bugs stem from the same root cause: the context range for Mata blocks excludes the `end` delimiter line, but various components need to account for this delimiter when processing the block.

## Glossary

- **Mata_Block**: An embedded Mata language block starting with `mata` and ending with `end`
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
