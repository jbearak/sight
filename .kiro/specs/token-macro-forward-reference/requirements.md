---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - forward-macro-reference-detection: [Core dependency]
Status: Active
Related Specs:
  - forward-scope-resolution: [Related cross-file spec]
  - cross-file-awareness: [Related cross-file spec]
  - working-directory-inheritance: [Related cross-file spec]
---

# Requirements Document

## Introduction

This feature extends forward macro reference detection to token-only macro references. The parent spec (forward-macro-reference-detection) implements position-aware undefined macro detection for AST-based references, but token-only references (macro references found in the token stream but not represented in the AST) currently bypass position checking. This creates inconsistent behavior where some forward references are detected and others are not.

Token-only macro references occur in:
- Standalone comments containing macro syntax
- Trivia nodes not attached to AST nodes
- Edge cases where the parser doesn't create AST nodes for certain macro usages

## Glossary

- **Token_Only_Reference**: A macro reference found in the token stream (MACRO_REF_LOCAL, MACRO_REF_GLOBAL tokens) that is not represented as an AST node
- **AST_Reference**: A macro reference represented as a macro_ref node in the AST
- **Token_Order_Index**: A position indicator derived from token stream order, used for forward reference detection of token-only references
- **Semantic_Analyzer**: The component that builds symbol tables and detects semantic issues

## Requirements

### Requirement 1: Position-Aware Token-Only Reference Checking

**User Story:** As a Stata developer, I want forward reference detection to work consistently for all macro references, including those only present in the token stream, so that I don't get surprised by inconsistent warnings.

#### Acceptance Criteria

1. WHEN a token-only local macro reference appears before the macro's definition (by token order), THE Semantic_Analyzer SHALL report an undefined macro warning for that reference
2. WHEN a token-only local macro reference appears after the macro's definition (by token order), THE Semantic_Analyzer SHALL NOT report an undefined macro warning
3. WHEN a token-only global macro reference appears before the macro's definition in the same file, THE Semantic_Analyzer SHALL report an undefined macro warning for that reference
4. WHEN a token-only global macro is defined in workspace symbols, THE Semantic_Analyzer SHALL NOT report an undefined macro warning regardless of token position

### Requirement 2: Consistent Behavior with AST References

**User Story:** As a Stata developer, I want token-only and AST-based macro references to behave identically for forward reference detection.

#### Acceptance Criteria

1. WHEN the same macro reference would produce a warning as an AST reference, THE Semantic_Analyzer SHALL also produce a warning if it's a token-only reference
2. WHEN the same macro reference would NOT produce a warning as an AST reference, THE Semantic_Analyzer SHALL also NOT produce a warning if it's a token-only reference
3. WHEN multiple definitions of the same macro exist, THE Semantic_Analyzer SHALL use the first definition's position for token-only forward reference detection (same as AST behavior)

### Requirement 3: Token Order Derivation

**User Story:** As a developer maintaining the LSP, I want a clear strategy for deriving position information from tokens.

#### Acceptance Criteria

1. WHEN processing token-only references, THE Semantic_Analyzer SHALL derive a position indicator from the token's location in the token stream
2. THE position indicator SHALL be comparable to AST preorder indices for consistent ordering
3. WHEN a token appears between two AST nodes, THE position indicator SHALL reflect that ordering correctly
