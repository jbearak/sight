# Requirements Document

## Introduction

The formatter-bugs spec introduced a source-preserving formatter that bypasses the AST and works directly on tokens. While this approach is safe and prevents code corruption, the AST-based PrettyPrinter is valuable for validating AST correctness and finding parser bugs. This document specifies requirements for exposing the formatter mode as a user-configurable VS Code setting, with source-preserving as the default and AST-based formatting as an experimental option.

## Glossary

- **Pretty_Printer**: The component that converts AST nodes back to valid Stata source code by walking the AST structure
- **Source_Preserving_Formatter**: The component that formats code by adjusting indentation on tokens while preserving original source text
- **AST**: Abstract Syntax Tree - the parsed representation of Stata source code
- **Code_Formatter**: The LSP provider that handles formatting requests
- **Formatter_Mode**: A configuration option that selects which formatting strategy to use

## Requirements

### Requirement 1: Configurable Formatter Mode

**User Story:** As a Stata developer, I want to choose between formatting strategies via VS Code settings, so that I can use the safe default or opt into experimental AST-based formatting.

#### Acceptance Criteria

1. THE Code_Formatter SHALL support a `formatting.mode` configuration option
2. THE `formatting.mode` option SHALL accept values "source-preserving" and "ast"
3. WHEN the formatter mode is set to "source-preserving", THE Code_Formatter SHALL use the Source_Preserving_Formatter
4. WHEN the formatter mode is set to "ast", THE Code_Formatter SHALL use the Pretty_Printer
5. THE Code_Formatter SHALL default to "source-preserving" mode

### Requirement 2: VS Code Settings Integration

**User Story:** As a Stata developer, I want to configure the formatter mode in VS Code settings, so that I can easily switch between formatting strategies.

#### Acceptance Criteria

1. THE VS Code extension SHALL expose a `sight.formatting.mode` setting
2. THE setting SHALL have a description indicating "ast" mode is experimental
3. THE setting SHALL default to "source-preserving"
4. WHEN the setting is changed, THE Code_Formatter SHALL use the new mode for subsequent formatting requests

### Requirement 3: AST-Based Formatting via Pretty Printer

**User Story:** As a Stata developer, I want to format code using the AST-based Pretty Printer when enabled, so that I can validate that the AST correctly represents my code structure.

#### Acceptance Criteria

1. WHEN the formatter mode is "ast", THE Code_Formatter SHALL invoke the Pretty_Printer with the parsed AST
2. WHEN the Pretty_Printer formats code, THE Pretty_Printer SHALL walk the AST nodes and reconstruct source code
3. WHEN the Pretty_Printer encounters an AST node, THE Pretty_Printer SHALL output valid Stata syntax for that node type

### Requirement 4: Graceful Error Handling

**User Story:** As a Stata developer, I want the formatter to handle errors gracefully, so that my code is never corrupted even if formatting fails.

#### Acceptance Criteria

1. IF the Pretty_Printer encounters an error during formatting, THEN THE Code_Formatter SHALL return no edits rather than corrupt the code
2. IF the Pretty_Printer produces invalid output, THEN THE Code_Formatter SHALL log a warning for debugging
3. WHEN formatting fails in AST mode, THE Code_Formatter SHALL NOT automatically fall back to source-preserving mode (to surface AST bugs)



### Requirement 5: Fix Source-Preserving Indentation Bug

**User Story:** As a Stata developer, I want the source-preserving formatter to respect my configured indent size, so that my code maintains consistent indentation.

#### Acceptance Criteria

1. WHEN the Source_Preserving_Formatter applies indentation, THE formatter SHALL use the configured indent size from formatting options
2. WHEN the indent size is set to 4 spaces, THE formatter SHALL NOT change it to 2 spaces
3. FOR ALL formatting operations, THE formatter SHALL preserve the user's configured indent size
