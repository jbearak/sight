---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - stata-lsp: [Core dependency]
Status: Active
Related Specs:
  - forward-scope-resolution: [Related cross-file spec]
  - cross-file-awareness: [Related cross-file spec]
  - working-directory-inheritance: [Related cross-file spec]
---

# Requirements Document

## Introduction

The LSP analyzer fails to register macro definitions that appear inside `else` blocks. This causes false positive "undefined macro" warnings when macros defined in `else` blocks are referenced later in the code. The root cause is that the `process_node` method in the analyzer handles `if`, `while`, and `frame` control flow nodes but does not handle `else` nodes, causing their bodies to be skipped during symbol table construction.

## Glossary

- **Analyzer**: The semantic analysis component (`src/analyzer/index.ts`) that builds symbol tables and detects undefined references
- **Symbol_Table**: A data structure that tracks all defined macros, variables, programs, and other symbols in a Stata file
- **Control_Flow_Node**: An AST node representing control flow structures like `if`, `else`, `while`, `foreach`, `forvalues`, and `frame`
- **Macro_Definition**: A `local` or `global` statement that defines a macro variable

## Requirements

### Requirement 1: Else Block Symbol Registration

**User Story:** As a Stata developer, I want macros defined inside `else` blocks to be recognized by the LSP, so that I don't receive false "undefined macro" warnings.

#### Acceptance Criteria

1. WHEN a `local` macro is defined inside an `else` block, THE Analyzer SHALL register it in the Symbol_Table
2. WHEN a `global` macro is defined inside an `else` block, THE Analyzer SHALL register it in the Symbol_Table
3. WHEN a macro defined in an `else` block is referenced after the block, THE Analyzer SHALL NOT emit an undefined macro warning
4. WHEN an `else` block contains nested control flow structures, THE Analyzer SHALL recursively process all nested bodies for symbol registration
5. WHEN an `else` block contains extended macro function definitions (e.g., `local x: variable label varname`), THE Analyzer SHALL register the macro in the Symbol_Table

### Requirement 2: Consistency with Other Control Flow Blocks

**User Story:** As a Stata developer, I want `else` blocks to be treated consistently with `if` blocks for symbol registration, so that the LSP behavior is predictable.

#### Acceptance Criteria

1. THE Analyzer SHALL process `else` blocks using the same `process_control_flow` method used for `if`, `while`, and `frame` blocks
2. WHEN both `if` and `else` branches define macros, THE Analyzer SHALL register macros from both branches in the Symbol_Table
