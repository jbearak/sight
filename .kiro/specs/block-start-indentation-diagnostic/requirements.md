# Requirements Document

## Introduction

This feature addresses two related indentation issues in the Stata LSP:

1. **Missing diagnostic for unnecessary indentation at block start**: When a control flow statement (like `if`) has leading whitespace but is at the top level (depth 0), the LSP should diagnose this as unnecessary indentation.

2. **Formatter not correcting mixed indentation inside blocks**: When lines inside a brace block have mixed indentation (e.g., space + tab), the formatter should normalize this to the correct indentation level.

## Glossary

- **Indentation_Diagnostic_Analyzer**: The component that analyzes Stata source code for indentation issues and emits diagnostics
- **Block_Start_Line**: A line containing a control flow statement that opens a block (e.g., `if (condition) {`, `foreach x in y {`)
- **Top_Level_Code**: Code at indentation depth 0, not inside any control flow block
- **Mixed_Indentation**: Whitespace that combines spaces and tabs (e.g., space followed by tab)
- **Source_Preserving_Formatter**: The formatter that preserves original source structure while applying indentation corrections

## Requirements

### Requirement 1: Diagnose Unnecessary Indentation at Top-Level Block Start

**User Story:** As a developer, I want to be warned when my top-level control flow statements have unnecessary leading whitespace, so that I can maintain consistent code formatting.

#### Acceptance Criteria

1. WHEN a control flow statement (`if`, `foreach`, `forvalues`, `while`, `program`, `mata`, `python`) appears at the top level (depth 0) with leading whitespace, THE Indentation_Diagnostic_Analyzer SHALL emit an UNNECESSARY_INDENTATION diagnostic
2. WHEN a control flow statement appears inside a block at the correct indentation level, THE Indentation_Diagnostic_Analyzer SHALL NOT emit an unnecessary indentation diagnostic
3. WHEN a control flow statement appears inside a block with insufficient indentation, THE Indentation_Diagnostic_Analyzer SHALL emit a MISSING_INDENTATION diagnostic (existing behavior)
4. THE diagnostic message SHALL indicate that the line appears unnecessarily indented and suggest using Format Document to fix

### Requirement 2: Diagnose Unnecessary Indentation for Any Top-Level Statement

**User Story:** As a developer, I want to be warned when any top-level statement has unnecessary leading whitespace, not just statements after comments.

#### Acceptance Criteria

1. WHEN any statement at the top level (depth 0) has leading whitespace, THE Indentation_Diagnostic_Analyzer SHALL emit an UNNECESSARY_INDENTATION diagnostic
2. WHEN a statement inside a block has more indentation than required, THE Indentation_Diagnostic_Analyzer SHALL emit an UNNECESSARY_INDENTATION diagnostic
3. THE Indentation_Diagnostic_Analyzer SHALL skip blank lines and comment-only lines when checking for unnecessary indentation
4. THE Indentation_Diagnostic_Analyzer SHALL respect continuation lines (lines following `///`) and not diagnose them as unnecessarily indented

### Requirement 3: Formatter Corrects Mixed Indentation Inside Blocks

**User Story:** As a developer, I want the formatter to normalize mixed indentation (space + tab) inside blocks to the correct indentation level.

#### Acceptance Criteria

1. WHEN a line inside a brace block has mixed indentation (space + tab), THE Source_Preserving_Formatter SHALL replace it with the correct indentation
2. WHEN the formatter is configured to use spaces, THE Source_Preserving_Formatter SHALL convert all leading whitespace to the correct number of spaces
3. WHEN the formatter is configured to use tabs, THE Source_Preserving_Formatter SHALL convert all leading whitespace to the correct number of tabs
4. THE Source_Preserving_Formatter SHALL preserve the content of the line after the leading whitespace

### Requirement 4: Integration Between Diagnostics and Formatter

**User Story:** As a developer, I want the diagnostics and formatter to be consistent, so that running Format Document fixes all diagnosed indentation issues.

#### Acceptance Criteria

1. FOR ALL lines with UNNECESSARY_INDENTATION diagnostics, THE Source_Preserving_Formatter SHALL remove the unnecessary indentation
2. FOR ALL lines with MISSING_INDENTATION diagnostics, THE Source_Preserving_Formatter SHALL add the correct indentation
3. AFTER running Format Document, THE Indentation_Diagnostic_Analyzer SHALL NOT emit any indentation diagnostics for the formatted code
