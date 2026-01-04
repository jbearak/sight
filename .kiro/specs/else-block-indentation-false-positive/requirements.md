# Requirements Document

## Introduction

This spec addresses two related bugs in the Sight LSP when handling `else` blocks that contain statements starting with macro references (e.g., `` `custom_arg' "arg1" "arg2" ``):

1. **False positive indentation diagnostic**: The LSP incorrectly flags correctly-indented lines inside `else` blocks as "unnecessarily indented"
2. **Formatter removes indentation**: When formatting, the formatter removes all leading whitespace from lines that the diagnostic flagged

The root cause is that the parser doesn't recognize macro references as valid command names, so statements like `` `custom_arg' "test" `` are not parsed into the AST. This causes the indentation analyzer to have no depth information for those lines.

## Glossary

- **Indentation_Diagnostic_Analyzer**: The component that analyzes indentation and reports unnecessary/missing indentation warnings
- **Source_Preserving_Formatter**: The formatter that preserves original source structure while applying formatting
- **Indentation_Analyzer**: The component that computes expected indentation depths from the AST
- **Macro_Reference**: A Stata local macro reference like `` `name' `` that can expand to a command name
- **Expected_Depth**: The computed nesting depth for a line based on AST analysis

## Requirements

### Requirement 1: Parser recognizes macro references as command names

**User Story:** As a developer, I want the parser to recognize macro references at the start of a line as potential command names, so that statements like `` `custom_arg' "arg1" `` are correctly parsed into the AST.

#### Acceptance Criteria

1. WHEN a statement starts with a MACRO_REF_LOCAL token, THE Parser SHALL parse it as a command node
2. WHEN a statement starts with a MACRO_REF_GLOBAL token, THE Parser SHALL parse it as a command node
3. WHEN an else block contains a statement starting with a macro reference, THE Parser SHALL include that statement in the else block's body array
4. WHEN parsing a macro-reference command, THE Parser SHALL capture all subsequent tokens until the statement terminator as arguments

### Requirement 2: Indentation diagnostic does not flag correctly-indented else block content

**User Story:** As a developer, I want the indentation diagnostic to correctly identify the expected depth for lines inside else blocks, so that correctly-indented code is not flagged as having unnecessary indentation.

#### Acceptance Criteria

1. WHEN an else block contains statements at nesting level N, THE Indentation_Diagnostic_Analyzer SHALL compute expected depth N+1 for lines inside the else block body
2. WHEN a line is correctly indented at its expected depth, THE Indentation_Diagnostic_Analyzer SHALL NOT emit an unnecessary indentation diagnostic
3. WHEN the AST has an else node with body.length > 0, THE Indentation_Diagnostic_Analyzer SHALL walk the body nodes to compute depths
4. WHEN an else block is at the top level (depth 0), THE Indentation_Diagnostic_Analyzer SHALL compute expected depth 1 for lines inside the else block body
5. WHEN an else block is nested inside other blocks (program, if, foreach, etc.), THE Indentation_Diagnostic_Analyzer SHALL compute expected depth relative to the cumulative nesting level
6. WHEN an else block is inside a mata block, THE Indentation_Diagnostic_Analyzer SHALL compute expected depths relative to the mata block's nesting level

### Requirement 3: Formatter preserves correct indentation in else blocks

**User Story:** As a developer, I want the formatter to preserve correct indentation for lines inside else blocks, so that formatting does not break my code structure.

#### Acceptance Criteria

1. WHEN formatting a line inside an else block, THE Source_Preserving_Formatter SHALL compute the correct indentation level based on nesting depth
2. WHEN the Indentation_Analyzer processes an else block with body nodes, THE Indentation_Analyzer SHALL set indent_level for body lines to current_depth + 1
3. WHEN formatting a line that was not in the AST, THE Source_Preserving_Formatter SHALL preserve the original indentation if it falls within a brace block
