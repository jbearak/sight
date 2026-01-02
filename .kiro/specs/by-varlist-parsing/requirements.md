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

This feature extends the Stata parser to correctly parse `by` and `bysort` prefix varlists that appear before the colon in commands like `by region year: summarize income`. The parsed variables will be attached to the AST node for use in analysis and completion.

## Glossary

- **By_Prefix**: The `by` or `bysort` (or abbreviation `bys`) keyword that precedes a varlist and colon
- **By_Varlist**: The list of variables specified after `by`/`bysort` and before the colon
- **Sort_Modifier**: Optional parenthesized sort order specification in bysort (e.g., `bysort region (year):`)
- **Prefixed_Command**: The command that follows the colon and operates within by-groups

## Requirements

### Requirement 1: Parse By Varlist

**User Story:** As a developer writing Stata code, I want the parser to recognize variables in `by` prefixes, so that go-to-definition and hover work for these variables.

#### Acceptance Criteria

1. WHEN parsing `by varlist: command`, THE Parser SHALL extract the By_Varlist and attach it to the AST node
2. WHEN parsing `bysort varlist: command`, THE Parser SHALL extract the By_Varlist and attach it to the AST node
3. WHEN parsing `bys varlist: command`, THE Parser SHALL treat it as `bysort` and extract the By_Varlist
4. THE Parser SHALL handle multiple variables in the By_Varlist (e.g., `by region year: cmd`)
5. THE Parser SHALL preserve variable order in the By_Varlist

### Requirement 2: Parse Sort Modifiers

**User Story:** As a developer using bysort with sort modifiers, I want the parser to correctly identify sorting variables, so that analysis is accurate.

#### Acceptance Criteria

1. WHEN parsing `bysort varlist (sortvar): command`, THE Parser SHALL distinguish grouping variables from Sort_Modifier variables
2. THE Parser SHALL attach both grouping and sorting variables to the AST node with appropriate markers
3. WHEN multiple sort variables are specified, THE Parser SHALL preserve their order
4. THE Parser SHALL handle nested parentheses in sort specifications correctly

### Requirement 3: AST Node Structure

**User Story:** As a developer of LSP features, I want by-prefix information in a consistent AST structure, so that providers can access it reliably.

#### Acceptance Criteria

1. THE Parser SHALL create a By_Prefix AST node containing: prefix type (by/bysort), grouping variables, and optional sort variables
2. THE By_Prefix node SHALL be attached to the Prefixed_Command node as a child or property
3. WHEN pretty-printing, THE Pretty_Printer SHALL reconstruct the original by-prefix syntax from the AST
4. FOR ALL valid by-prefix commands, parsing then pretty-printing SHALL produce equivalent syntax

### Requirement 4: Integration with Analysis

**User Story:** As a developer, I want by-prefix variables to be recognized by the analyzer, so that undefined variable warnings work correctly.

#### Acceptance Criteria

1. WHEN analyzing a by-prefix command, THE Analyzer SHALL include By_Varlist variables in scope checking
2. WHEN a By_Varlist variable is undefined, THE Analyzer SHALL report an appropriate diagnostic
3. THE Analyzer SHALL recognize by-prefix variables for completion suggestions within the prefixed command

### Requirement 5: Edge Cases

**User Story:** As a developer, I want the parser to handle edge cases in by-prefix syntax correctly.

#### Acceptance Criteria

1. WHEN `by` appears without a colon (as a command), THE Parser SHALL not treat it as a prefix
2. WHEN the varlist is empty (`by: cmd`), THE Parser SHALL report a syntax error
3. WHEN the colon is missing (`by region summarize`), THE Parser SHALL handle gracefully with appropriate error recovery
4. THE Parser SHALL handle by-prefixes with continuation lines correctly
