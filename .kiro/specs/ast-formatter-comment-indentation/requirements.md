# Requirements Document

## Introduction

This document specifies the requirements for fixing a bug in the AST formatter where comments (leading trivia) are printed at the beginning of the line without respecting the current indentation scope. When using the AST formatter mode, comments inside control flow blocks, programs, or other nested structures should be indented to match their logical scope depth, just like the source-preserving formatter does.

## Glossary

- **AST_Formatter**: The formatter implementation that rebuilds code from the Abstract Syntax Tree using the PrettyPrinter. Configured via `formatting.mode = "ast"`.
- **Source_Preserving_Formatter**: The default formatter that preserves original source structure while applying formatting adjustments.
- **Leading_Trivia**: Comments that appear before a statement node in the AST.
- **Trailing_Trivia**: Comments that appear after a statement on the same line.
- **Indentation_Scope**: The nesting depth determined by control flow structures (if/else, foreach, forvalues, while), program definitions, and embedded blocks.
- **PrettyPrinter**: The component (`src/pretty-printer/index.ts`) that converts AST nodes back to valid Stata source code.

## Requirements

### Requirement 1: Leading Comment Indentation

**User Story:** As a developer using the AST formatter, I want comments inside nested blocks to be indented to match their scope depth, so that the formatted code maintains proper visual structure.

#### Acceptance Criteria

1. WHEN the AST_Formatter prints a leading comment inside a control flow block, THE PrettyPrinter SHALL indent the comment to match the current indentation level.
2. WHEN the AST_Formatter prints a leading comment inside a program definition, THE PrettyPrinter SHALL indent the comment to match the program body indentation level.
3. WHEN the AST_Formatter prints a leading comment at the top level (depth 0), THE PrettyPrinter SHALL print the comment without indentation.
4. WHEN multiple leading comments exist before a statement, THE PrettyPrinter SHALL indent each comment to the same indentation level as the statement.

### Requirement 2: Nested Block Comment Indentation

**User Story:** As a developer, I want comments in deeply nested blocks to be indented correctly at each nesting level, so that the code structure is visually clear.

#### Acceptance Criteria

1. WHEN the AST_Formatter prints a comment inside a nested control flow block (e.g., if inside foreach), THE PrettyPrinter SHALL indent the comment to match the cumulative nesting depth.
2. FOR ALL nesting depths N, WHEN a comment appears at depth N, THE PrettyPrinter SHALL apply N levels of indentation to the comment.

### Requirement 3: Trailing Comment Preservation

**User Story:** As a developer, I want trailing comments (on the same line as code) to remain on the same line after formatting, so that inline documentation is preserved.

#### Acceptance Criteria

1. WHEN the AST_Formatter prints a trailing comment, THE PrettyPrinter SHALL keep the comment on the same line as the statement.
2. WHEN the AST_Formatter prints a trailing comment, THE PrettyPrinter SHALL NOT add indentation before the comment (only a space separator).

### Requirement 4: Formatter Mode Consistency

**User Story:** As a developer, I want both formatter modes to produce consistently indented comments, so that switching between modes doesn't drastically change comment positioning.

#### Acceptance Criteria

1. WHEN formatting code with comments using the AST_Formatter, THE output comment indentation SHALL match the logical scope depth.
2. WHEN formatting the same code with both formatter modes, THE comment indentation levels SHALL be equivalent (though exact whitespace may differ based on mode characteristics).
