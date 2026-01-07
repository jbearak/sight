# Requirements Document

## Introduction

This feature addresses two related improvements to Stata macro handling in the LSP:

1. **Inline colon-expression evaluation**: Stata supports `` `:extended_function' `` syntax for inline evaluation within commands. For example, `` `:type mpg' `` returns the variable type at expansion time. The LSP currently treats these as undefined macro references and emits false positive warnings. (Note: The LSP already correctly handles `` `=expression' `` inline equals-expressions.)

2. **Extended macro function spacing**: The colon in extended macro function syntax (`local x : type mpg`) should have a space before it, unlike prefix commands (`frame: display`). The formatter should preserve or normalize this spacing appropriately.

## Glossary

- **Inline_Expression**: A Stata construct using `` `=expression' `` syntax that evaluates an expression at macro expansion time
- **Extended_Macro_Function**: A Stata construct using `: function` syntax to invoke macro functions (e.g., `:type`, `:word count`)
- **Macro_Assignment**: A `local` or `global` command that assigns a value to a macro
- **Prefix_Command**: A command modifier that precedes another command with a colon (e.g., `quietly:`, `frame name:`)
- **Lexer**: The component that tokenizes Stata source code into tokens
- **Analyzer**: The component that performs semantic analysis and detects undefined references

## Requirements

### Requirement 1: Verify Inline Equals-Expression Syntax (Existing)

**User Story:** As a Stata developer, I want to confirm the LSP correctly recognizes `` `=expression' `` inline expressions, so that I don't receive false positive undefined macro warnings for valid Stata code.

#### Acceptance Criteria

1. WHEN the Lexer encounters `` `= `` followed by an expression and closing `` ' ``, THE Lexer SHALL tokenize it as a local macro reference token
2. WHEN the Analyzer processes a token whose content starts with `=`, THE Analyzer SHALL NOT emit an undefined macro warning (existing behavior)
3. WHEN an inline expression contains nested macro references (e.g., `` `=`n'+1' ``), THE Analyzer SHALL still validate those nested macro references
4. WHEN an inline expression is malformed (unclosed or invalid), THE Lexer SHALL handle it gracefully without crashing

### Requirement 2: Distinguish Inline Expression from Macro Reference

**User Story:** As a Stata developer, I want the LSP to correctly distinguish between inline expressions and macro references, so that diagnostics are accurate.

#### Acceptance Criteria

1. WHEN the content after `` ` `` starts with `=`, THE Analyzer SHALL treat it as an inline expression evaluation and skip undefined macro checking (existing behavior)
2. WHEN the content after `` ` `` starts with `:`, THE Analyzer SHALL treat it as an inline extended function and skip undefined macro checking (new behavior)
3. WHEN the content after `` ` `` does not start with `=` or `:`, THE Analyzer SHALL treat it as a macro reference and check if it's defined
4. WHEN an inline expression appears in any valid Stata context (commands, options, strings), THE Lexer SHALL correctly tokenize it

### Requirement 3: Support Inline Colon-Expression Syntax (New)

**User Story:** As a Stata developer, I want the LSP to recognize `` `:extended_function' `` inline expressions, so that I don't receive false positive warnings for valid Stata code.

#### Acceptance Criteria

1. WHEN the Lexer encounters `` `: `` followed by an extended function and closing `` ' ``, THE Lexer SHALL tokenize it as a local macro reference token
2. WHEN the Analyzer processes a token whose content starts with `:`, THE Analyzer SHALL NOT emit an undefined macro warning (new behavior)
3. WHEN an inline extended function is used in any valid context, THE Lexer SHALL correctly tokenize it

### Requirement 4: Extended Macro Function Spacing in Assignments

**User Story:** As a Stata developer, I want the formatter to preserve appropriate spacing around colons in macro assignments, so that my code follows Stata conventions.

#### Acceptance Criteria

1. WHEN formatting a macro assignment with extended function syntax (e.g., `local x : type mpg`), THE Formatter SHALL preserve or ensure a space before the colon
2. WHEN formatting a prefix command (e.g., `quietly: display`), THE Formatter SHALL NOT add a space before the colon (existing behavior)
3. WHEN the original code has no space before the colon in a macro assignment, THE Formatter SHALL add a space to normalize the style

### Requirement 5: Completion and Hover for Inline Expressions (Out of Scope)

**Status:** Deferred to future enhancement. The current implementation focuses on eliminating false positive warnings. Completion and hover enhancements for inline expressions may be added in a future iteration.

**User Story:** As a Stata developer, I want completion and hover to work appropriately with inline expressions, so that I get helpful IDE features.

#### Acceptance Criteria (Deferred)

1. WHEN the cursor is inside an inline expression (`` `=...| ``), THE Completion_Provider SHALL offer expression-appropriate completions (functions, variables, macros)
2. WHEN hovering over an inline expression, THE Hover_Provider SHALL display information about the expression type
3. WHEN the cursor is inside an inline extended function (`` `:...| ``), THE Completion_Provider SHALL offer extended function completions where feasible
