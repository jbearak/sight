# Requirements Document

## Introduction

This bugfix addresses an incorrect context classification in the `OperatorSequenceAnalyzer` for C-style logical operators (`&&`, `||`). The analyzer incorrectly classifies these operators as being in "control flow" context when they are actually in an "if qualifier" context inside a control flow body.

## Bug Description

When a C-style logical operator appears inside the body of an `if` control flow statement (not in its condition), but within an `if` qualifier on a command, the analyzer incorrectly returns `'control_flow'` context instead of `'qualifier'` context.

### Reproduction Case

```stata
if (1 && 1) {
    gen x = y if 1 && 2
}
```

Expected behavior:
- Line 1: `if (1 && 1)` - should emit Information diagnostic (code 6003) ✓ CORRECT
- Line 2: `gen x = y if 1 && 2` - should emit Error diagnostic (code 6002) ✗ WRONG: currently emits Information diagnostic (code 6003)

## Root Cause

In `src/providers/operator-sequence-diagnostics.ts`, the `find_context_in_nodes` method has incorrect logic for `if`/`else` control flow nodes. When a control flow node has a condition, the code returns `'control_flow'` immediately without first checking if the operator is actually in the body (where it might be in a nested command with an if qualifier).

## Glossary

- **Operator_Sequence_Analyzer**: The component that inspects adjacent operator tokens to detect malformed sequences, including context-dependent C-style logical operators.
- **If_Control_Flow_Context**: The condition expression within an `if` or `else if` control flow statement (e.g., `if condition { ... }`). In this context, `&&` and `||` work synonymously with `&` and `|`.
- **If_Qualifier_Context**: The condition expression within an `if` qualifier on a command (e.g., `gen x = 1 if condition`). In this context, `&&` and `||` are NOT valid Stata syntax.
- **Control_Flow_Body**: The block of statements executed when a control flow condition is true (the code between `{` and `}`).

## Requirements

### Requirement 1: Correct Context Detection Order

**User Story:** As a Stata developer, I want the LSP to correctly identify when C-style logical operators are in an if qualifier inside a control flow body, so that I receive accurate error diagnostics.

#### Acceptance Criteria

1. WHEN a C-style logical operator (`&&`, `||`) appears in an if qualifier on a command inside a control flow body, THE Operator_Sequence_Analyzer SHALL classify it as `'qualifier'` context
2. WHEN a C-style logical operator (`&&`, `||`) appears in the condition of an if/else if control flow statement, THE Operator_Sequence_Analyzer SHALL classify it as `'control_flow'` context
3. WHEN determining context for a C-style logical operator inside a control flow node, THE Operator_Sequence_Analyzer SHALL first recursively check the body for nested contexts before checking the condition
4. IF the body check returns a non-`'other'` context, THEN THE Operator_Sequence_Analyzer SHALL return that context instead of `'control_flow'`

### Requirement 2: Correct Diagnostic Emission

**User Story:** As a Stata developer, I want to receive error diagnostics for invalid C-style logical operators in if qualifiers, even when those qualifiers are inside control flow bodies.

#### Acceptance Criteria

1. WHEN a C-style logical operator is classified as `'qualifier'` context, THE Operator_Sequence_Analyzer SHALL emit an Error diagnostic with code `INVALID_OPERATOR_SEQUENCE` (6002)
2. WHEN a C-style logical operator is classified as `'control_flow'` context, THE Operator_Sequence_Analyzer SHALL emit an Information diagnostic with code `CSTYLE_LOGICAL_IN_CONTROL_FLOW` (6003)
3. THE diagnostic messages SHALL match the existing message templates defined in the malformed-operator-diagnostics feature

### Requirement 3: Nested Control Flow Handling

**User Story:** As a Stata developer, I want the context detection to work correctly for deeply nested control flow structures.

#### Acceptance Criteria

1. WHEN a C-style logical operator appears in an if qualifier inside multiple levels of nested control flow, THE Operator_Sequence_Analyzer SHALL correctly classify it as `'qualifier'` context
2. WHEN a C-style logical operator appears in the condition of a nested if/else if inside a control flow body, THE Operator_Sequence_Analyzer SHALL correctly classify it as `'control_flow'` context
