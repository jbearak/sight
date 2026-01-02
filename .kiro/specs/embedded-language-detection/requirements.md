---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - stata-lsp: [Core dependency]
Status: Active
Related Specs:
  - command-database-cleanup: [Related completion spec]
  - option-extraction: [Related completion spec]
  - syntax-command-simplification: [Related completion spec]
---

# Requirements Document

## Introduction

This document specifies the requirements for extending the Stata Language Server Protocol (LSP) to detect and handle embedded language blocks within Stata do-files. Stata allows embedding Mata (matrix programming language) and Python code blocks within do-files using specific delimiters. The LSP needs to understand when it is parsing Stata code versus embedded language code to provide accurate language features and avoid false diagnostics.

## Glossary

- **Embedded_Language_Block**: A section of code within a Stata do-file that contains non-Stata code (Mata or Python)
- **Language_Context**: The current parsing context indicating whether the LSP is processing Stata, Mata, or Python code
- **Block_Delimiter**: Special commands or syntax that mark the beginning and end of embedded language blocks
- **Context_Tracker**: The component that maintains the current language context during parsing
- **Mata_Block**: A section of Mata code within a Stata do-file, delimited by `mata` and `end` commands
- **Python_Block**: A section of Python code within a Stata do-file, delimited by `python` and `end python` commands
- **Stata_Context**: The default parsing context where normal Stata commands and syntax are expected

## Requirements

### Requirement 1: Mata Block Detection

**User Story:** As a developer writing Stata code with embedded Mata blocks, I want the LSP to recognize when I'm inside a Mata block, so that it doesn't apply Stata syntax rules to my Mata code.

#### Acceptance Criteria

1. WHEN the Parser encounters a `mata` command at the start of a statement, THE Context_Tracker SHALL switch to Mata context
2. WHEN the Parser encounters a `mata:` command (with colon), THE Context_Tracker SHALL switch to Mata context for a single statement only
3. WHEN in Mata context and the Parser encounters an `end` command at the start of a statement, THE Context_Tracker SHALL switch back to Stata context
4. WHEN in Mata context, THE Parser SHALL treat all content as raw text and not attempt to parse it as Stata syntax
5. WHEN in Mata context, THE Lexer SHALL still tokenize basic structures (strings, comments, braces) for bracket matching but not emit Stata-specific tokens
6. WHEN the Parser encounters nested `mata` blocks, THE Context_Tracker SHALL handle the nesting correctly using a context stack

### Requirement 2: Python Block Detection

**User Story:** As a developer writing Stata code with embedded Python blocks, I want the LSP to recognize when I'm inside a Python block, so that it doesn't apply Stata syntax rules to my Python code.

#### Acceptance Criteria

1. WHEN the Parser encounters a `python` command at the start of a statement, THE Context_Tracker SHALL switch to Python context
2. WHEN the Parser encounters a `python:` command (with colon), THE Context_Tracker SHALL switch to Python context for a single statement only
3. WHEN in Python context and the Parser encounters an `end python` command sequence, THE Context_Tracker SHALL switch back to Stata context
4. WHEN in Python context, THE Parser SHALL treat all content as raw text and not attempt to parse it as Stata syntax
5. WHEN in Python context, THE Lexer SHALL still tokenize basic structures (strings, comments, braces) for bracket matching but not emit Stata-specific tokens
6. WHEN the Parser encounters nested `python` blocks, THE Context_Tracker SHALL handle the nesting correctly using a context stack

### Requirement 3: Context-Aware Diagnostics

**User Story:** As a developer, I want the LSP to only report Stata syntax errors when I'm actually in Stata code, so that I don't get false error reports for valid Mata or Python syntax.

#### Acceptance Criteria

1. WHEN in Mata or Python context, THE Diagnostics_Provider SHALL suppress Stata-specific syntax error diagnostics
2. WHEN in Mata or Python context, THE Diagnostics_Provider SHALL still report basic structural errors (unbalanced quotes, unbalanced braces)
3. WHEN transitioning between contexts, THE Diagnostics_Provider SHALL validate that block delimiters are properly matched
4. WHEN an embedded language block is not properly closed before EOF, THE Diagnostics_Provider SHALL report an error diagnostic
5. WHEN block delimiters are malformed (e.g., `end mata` instead of `end` in Mata context), THE Diagnostics_Provider SHALL report an error diagnostic

### Requirement 4: Context-Aware Completion

**User Story:** As a developer, I want code completion to be appropriate for my current context, so that I get Stata completions in Stata code and no inappropriate completions in embedded language blocks.

#### Acceptance Criteria

1. WHEN in Stata context, THE Completion_Provider SHALL provide normal Stata command and symbol completions
2. WHEN in Mata context, THE Completion_Provider SHALL not provide Stata command completions
3. WHEN in Python context, THE Completion_Provider SHALL not provide Stata command completions
4. WHEN at the boundary of an embedded language block, THE Completion_Provider SHALL suggest appropriate block-ending commands (`end`, `end python`)
5. WHEN in embedded language context, THE Completion_Provider SHALL still provide basic completions for local and global macros that may be referenced

### Requirement 5: Context-Aware Hover Information

**User Story:** As a developer, I want hover information to be context-appropriate, so that I don't get Stata command documentation when hovering over Mata or Python keywords.

#### Acceptance Criteria

1. WHEN in Stata context, THE Hover_Provider SHALL provide normal Stata command and symbol hover information
2. WHEN in Mata context, THE Hover_Provider SHALL not provide Stata command hover information for Mata keywords
3. WHEN in Python context, THE Hover_Provider SHALL not provide Stata command hover information for Python keywords
4. WHEN hovering over block delimiter commands (`mata`, `python`, `end`), THE Hover_Provider SHALL provide information about the embedded language block syntax
5. WHEN in embedded language context, THE Hover_Provider SHALL still provide hover information for Stata macros that may be referenced

### Requirement 6: Context-Aware Symbol Navigation

**User Story:** As a developer, I want symbol navigation features to work correctly across language contexts, so that I can navigate to Stata symbols from within embedded language blocks.

#### Acceptance Criteria

1. WHEN in embedded language context, THE Definition_Provider SHALL still resolve Stata macro references to their definitions
2. WHEN in embedded language context, THE Definition_Provider SHALL not attempt to resolve embedded language symbols as Stata symbols
3. WHEN requesting document symbols, THE Symbol_Provider SHALL include embedded language blocks as structural elements
4. WHEN an embedded language block contains Stata macro references, THE Symbol_Provider SHALL track those references for cross-context navigation

### Requirement 7: Context-Aware Formatting

**User Story:** As a developer, I want code formatting to preserve embedded language blocks, so that my Mata and Python code formatting is not corrupted by Stata formatting rules.

#### Acceptance Criteria

1. WHEN formatting a document containing embedded language blocks, THE Formatter SHALL preserve the content of Mata and Python blocks unchanged
2. WHEN formatting, THE Formatter SHALL properly indent block delimiter commands according to Stata formatting rules
3. WHEN formatting, THE Formatter SHALL maintain proper spacing around block delimiters
4. THE Formatter SHALL not attempt to apply Stata formatting rules to content within embedded language blocks

### Requirement 8: Robust Block Boundary Detection

**User Story:** As a developer, I want the LSP to correctly handle edge cases in embedded language block detection, so that it works reliably with real-world code patterns.

#### Acceptance Criteria

1. WHEN a `mata` or `python` command appears within a Stata comment, THE Context_Tracker SHALL not switch contexts
2. WHEN a `mata` or `python` command appears within a Stata string literal, THE Context_Tracker SHALL not switch contexts
3. WHEN `end` appears within an embedded language block as part of that language's syntax, THE Context_Tracker SHALL not prematurely exit the block
4. WHEN embedded language blocks contain Stata-like syntax (e.g., comments starting with `//`), THE Context_Tracker SHALL maintain the correct context
5. WHEN the document contains malformed or incomplete embedded language blocks, THE Context_Tracker SHALL recover gracefully and continue parsing
6. WHEN `mata:` or `python:` (single-line forms) are used, THE Context_Tracker SHALL return to Stata context after the statement terminator

### Requirement 9: Context State Persistence

**User Story:** As a developer editing files with embedded language blocks, I want the LSP to maintain context state correctly during incremental parsing, so that language features remain accurate as I type.

#### Acceptance Criteria

1. WHEN a document is incrementally updated, THE Context_Tracker SHALL correctly update the language context based on the changes
2. WHEN edits occur within an embedded language block, THE Context_Tracker SHALL maintain the correct context for the block
3. WHEN block delimiters are added or removed, THE Context_Tracker SHALL update all affected ranges accordingly
4. WHEN the document is reparsed, THE Context_Tracker SHALL produce consistent context information
5. THE Context_Tracker SHALL provide context information that can be used by all LSP providers (completion, hover, diagnostics, etc.)

### Requirement 10: Block Delimiter Validation

**User Story:** As a developer, I want the LSP to validate that my embedded language blocks are properly structured, so that I can catch syntax errors in block delimiters.

#### Acceptance Criteria

1. WHEN a `mata` block is not closed with `end`, THE Diagnostics_Provider SHALL report an error diagnostic
2. WHEN a `python` block is not closed with `end python`, THE Diagnostics_Provider SHALL report an error diagnostic
3. WHEN an `end` command appears without a corresponding opening block, THE Diagnostics_Provider SHALL report an error diagnostic
4. WHEN `end python` appears outside of a Python block, THE Diagnostics_Provider SHALL report an error diagnostic
5. WHEN nested embedded language blocks have mismatched delimiters, THE Diagnostics_Provider SHALL report appropriate error diagnostics
6. WHEN block delimiters appear in invalid positions (e.g., not at statement boundaries), THE Diagnostics_Provider SHALL report error diagnostics