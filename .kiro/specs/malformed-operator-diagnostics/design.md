# Design Document: Malformed Operator Diagnostics

## Overview

This feature adds an `OperatorSequenceAnalyzer` that inspects adjacent OPERATOR tokens in Stata source code to detect three categories of malformed sequences:

1. **Suggestible sequences** — spaced compound operators like `< =` that likely meant `<=` (Warning severity)
2. **Invalid sequences** — operator combinations with no valid Stata meaning like `< |` or `& &` (Error severity)
3. **Context-dependent sequences** — C-style logical operators (`&&`, `||`) that are valid in `if`/`else if` control flow statements but invalid in `if` qualifiers (Informational severity in control flow, Error in qualifiers)

The analyzer follows the established `IndentationDiagnosticAnalyzer` pattern: a standalone class instantiated by `DiagnosticsProvider`, receiving `DocumentState` and `StataLSPConfig`, and returning `Diagnostic[]`. It operates on the token stream (not the AST), scanning for adjacent OPERATOR token pairs separated only by trivia (WHITESPACE, CONTINUATION) — not by STATEMENT_TERMINATOR or non-trivia tokens.

**Key distinction for C-style logical operators:**
- In `if condition { ... }` or `else if condition { ... }` control flow statements, `&&` and `||` work synonymously with `&` and `|`. These emit optional informational diagnostics (configurable, default on).
- In `if` qualifiers on commands (e.g., `gen x = 1 if a == 1 && b == 1`), `&&` and `||` are NOT valid and emit error diagnostics.

The lexer already handles context filtering: operators inside strings produce STRING tokens, and operators inside comments produce COMMENT tokens. The analyzer only needs to additionally skip tokens in Mata/Python embedded blocks (via `ContextTracker`).

## Architecture

```mermaid
flowchart TD
    A[DocumentState] --> B[OperatorSequenceAnalyzer.analyze]
    B --> X{All configs 'off'?}
    X -->|Yes| Y[Return empty array]
    X -->|No| C[Filter tokens to Stata context only]
    C --> D[Scan for adjacent OPERATOR pairs]
    D --> E{Pair type?}
    E -->|Suggestible| F[Emit Warning diagnostic with suggestion]
    E -->|Invalid| G[Emit Error diagnostic]
    E -->|C-style in control flow| H{cStyleLogicalInControlFlow config?}
    E -->|Valid/Allowed| I[Skip]
    H -->|'off'| I
    H -->|other| J[Emit Informational diagnostic]
    F --> K[Apply @lsp-ignore suppression]
    G --> K
    J --> K
    K --> L[Apply config severity override]
    L --> M[Return Diagnostic array]
```

The analyzer is integrated into the existing diagnostics pipeline:

```mermaid
flowchart LR
    DP[DiagnosticsProvider.get_diagnostics] --> LA[Lexer Errors]
    DP --> PA[Parser Errors]
    DP --> SA[Semantic Diagnostics]
    DP --> IA[IndentationDiagnosticAnalyzer]
    DP --> OA[OperatorSequenceAnalyzer]
    DP --> DD[Directive Diagnostics]
    LA & PA & SA & IA & OA & DD --> R[Combined Diagnostics]
```

### Design Decisions

1. **Token-level analysis, not AST-level**: The analyzer works on the flat token array. Adjacent OPERATOR tokens separated only by trivia are suspicious by definition — no AST structure is needed. This keeps the implementation simple and decoupled from parser changes.

2. **AST-assisted context detection for C-style logical operators**: While the main analysis is token-based, detecting whether `&&`/`||` appears in an `if` control flow statement vs an `if` qualifier requires AST information. The analyzer uses the AST to determine context:
   - `ControlFlowNode` with `type: 'if'` or `type: 'else'` (with nested `if`) → control flow context
   - `CommandNode` with `ifExpression` → qualifier context
   - The analyzer maps token positions to AST node ranges to determine context.

3. **Allowlist for valid adjacencies**: Rather than trying to enumerate all invalid pairs, the analyzer defines explicit sets for suggestible and invalid pairs, and an allowlist for valid adjacent operator combinations (e.g., comparison + arithmetic like `< +`). Any pair not in these sets is ignored (no diagnostic).

4. **Three-category severity config**: Three config fields:
   - `diagnostics.severity.malformedOperator` (default `'warning'`) for suggestible sequences
   - `diagnostics.severity.invalidOperatorSequence` (default `'error'`) for invalid sequences
   - `diagnostics.severity.cStyleLogicalInControlFlow` (default `'information'`) for C-style logical operators in control flow contexts
   
   This follows the existing pattern of separate fields per diagnostic category. When any is `'off'`, that category is suppressed.

5. **Suppression reuses `ignored_lines` from `DocumentState`**: The `SemanticAnalyzer` already computes `ignored_lines` (a `Set<number>` of line numbers suppressed by `@lsp-ignore` / `@lsp-ignore-next` directives) during semantic analysis. Currently this set is internal to `AnalyzerConfig`. To avoid duplicating the token-scanning logic and re-scanning tokens, `ignored_lines` will be exposed on `DocumentState` — populated by the `SemanticAnalyzer` alongside other analysis results (tokens, AST, symbols). The `OperatorSequenceAnalyzer` simply checks `document.ignored_lines.has(line)` for each diagnostic it would emit. This is consistent with how `DocumentState` already stores all analysis outputs, and the existing scanning covers all comment styles (`//`, `*`, `/* */`) and handles `@lsp-ignore-next` by skipping over WHITESPACE, CONTINUATION, COMMENT_LINE, COMMENT_BLOCK, and STATEMENT_TERMINATOR tokens to find the target line. Note: the `@lsp-ignore-next` skip list is broader than the adjacency-detection "trivia" definition (which is WHITESPACE + CONTINUATION only).

6. **Lexer prerequisite for `~=`**: The current lexer does not produce `~=` as a compound token. Before implementing the analyzer, the lexer must be updated to recognize `~=` as a compound operator (matching `!=`, `<=`, `>=`, `==`). Without this, `~=` without spaces would be incorrectly flagged as a suggestible sequence.

## Components and Interfaces

### DocumentState Extension (`src/document-store.ts`)

Add `ignored_lines` to the `DocumentState` interface:

```typescript
export interface DocumentState {
  // ... existing fields ...

  // Lines suppressed by @lsp-ignore / @lsp-ignore-next directives
  ignored_lines: Set<number>;
}
```

The `SemanticAnalyzer` already computes this set (in `AnalyzerConfig.ignored_lines`). The change is to copy it onto `DocumentState` after analysis completes, alongside the existing `symbols` and `diagnostics` fields.

### OperatorSequenceAnalyzer

**File**: `src/providers/operator-sequence-diagnostics.ts`

```typescripttypescript
import { Diagnostic } from 'vscode-languageserver/node';
import { DocumentState } from '../document-store';
import { StataLSPConfig } from '../types';

export class OperatorSequenceAnalyzer {
    /**
     * Analyze a document's token stream for malformed operator sequences.
     * Returns diagnostics for suggestible and invalid operator pairs.
     */
    analyze(document: DocumentState, config: StataLSPConfig): Diagnostic[];
}
```

**Integration point**: `DiagnosticsProvider` instantiates `OperatorSequenceAnalyzer` as a private field (same pattern as `indentation_analyzer`) and calls `analyze()` in `get_diagnostics()`, filtering results through embedded context checks.

### Operator Pair Classification

The analyzer classifies operator pairs using lookup maps:

```typescripttypescript
/** Suggestible pairs: spaced compound operators with a known intended form */
const SUGGESTIBLE_PAIRS: Map<string, string> = new Map([
    ['< =', '<='],
    ['> =', '>='],
    ['! =', '!='],
    ['~ =', '~='],
    ['= =', '=='],
]);

/** Invalid pairs: operator combinations with no valid Stata meaning (context-independent) */
const INVALID_PAIRS: Set<string> = new Set([
    // Comparison + logical
    '< |', '< &', '> |', '> &',
    // Logical + comparison
    '| <', '| >', '& <', '& >',
    // Logical + assignment
    '| =',
    // Double logical
    '| &', '& |',
    // Double comparison
    '< <', '> >', '< >', '> <',
]);

/** C-style logical pairs: context-dependent validity */
const CSTYLE_LOGICAL_PAIRS: Set<string> = new Set([
    '| |',  // || - valid in if/else if control flow, invalid in if qualifier
    '& &',  // && - valid in if/else if control flow, invalid in if qualifier
]);

/** Pairs that get specialized messages */
const SPECIAL_MESSAGES: Map<string, string> = new Map([
    ['| =', "Stata does not support compound assignment operators"],
]);

/** Messages for C-style logical in if qualifier context (error) */
const CSTYLE_QUALIFIER_MESSAGES: Map<string, string> = new Map([
    ['| |', "Stata uses '|' for logical OR, not '||'"],
    ['& &', "Stata uses '&' for logical AND, not '&&'"],
]);

/** Messages for C-style logical in control flow context (informational) */
const CSTYLE_CONTROL_FLOW_MESSAGES: Map<string, string> = new Map([
    ['| |', "C-style '||' operator in if condition. Consider using '|' for consistency with Stata style"],
    ['& &', "C-style '&&' operator in if condition. Consider using '&' for consistency with Stata style"],
]);

/** Arithmetic operators — adjacency with comparison is valid */
const ARITHMETIC_OPS: Set<string> = new Set(['+', '-', '*', '/', '^']);

/** Comparison operators */
const COMPARISON_OPS: Set<string> = new Set(['<', '>']);

/** Negation operators */
const NEGATION_OPS: Set<string> = new Set(['!', '~']);
```

### Context Detection for C-Style Logical Operators

To determine whether a C-style logical operator (`&&`, `||`) appears in an `if` control flow statement or an `if` qualifier, the analyzer uses the AST:

```typescripttypescript
interface OperatorContext {
    kind: 'control_flow' | 'qualifier' | 'other';
}

/**
 * Determine the context of an operator pair by checking if it falls within
 * an if/else if control flow condition or an if qualifier expression.
 */
function get_operator_context(
    first_token: Token,
    second_token: Token,
    ast: StataAST
): OperatorContext {
    // Walk the AST to find nodes containing the operator position
    // Check for ControlFlowNode with type 'if' or 'else' (with nested if)
    // Check for CommandNode with ifExpression
    // Return appropriate context
}
```

The context detection algorithm:
1. Find all AST nodes whose range contains the operator pair
2. Check if any is a `ControlFlowNode` with `type: 'if'` or `type: 'else'` — if so, return `'control_flow'`
3. Check if any is a `CommandNode` with `ifExpression` and the operator is within the if expression range — if so, return `'qualifier'`
4. Otherwise return `'other'` (treat as invalid, same as qualifier context)

### Adjacency Detection Algorithm

Two OPERATOR tokens are considered "adjacent" if and only if all tokens between them are trivia (WHITESPACE or CONTINUATION). A STATEMENT_TERMINATOR, COMMENT_LINE, or COMMENT_BLOCK token between them breaks adjacency.

```text
for each token[i] where token[i].type === 'OPERATOR':
    find next non-trivia token token[j]
    if any token between i and j is STATEMENT_TERMINATOR, COMMENT_LINE, or COMMENT_BLOCK: skip
    if token[j].type !== 'OPERATOR': skip
    classify pair (token[i].value, token[j].value)
    if pair matched (suggestible or invalid): advance i past j (skip second token)
```

When a pair is matched, the scanner advances past the second token to avoid overlapping diagnostics. For example, `< = =` produces one diagnostic for `< =` (the `=` at position j is consumed), then the second `=` is evaluated as a new first token. Without this skip, `< = =` would produce two diagnostics (`< =` and `= =`), which would be confusing since the first diagnostic already identifies the fix.

### Valid Adjacency Allowlist

The following adjacent operator combinations are valid and produce no diagnostic:

- **Comparison + arithmetic** (either order): `< +`, `+ <`, `> *`, `^ >`, etc.
- **Negation before comparison**: `! <`, `! >`, `~ <`, `~ >`

### Diagnostic Message Templates

| Pair Type | Context | Message Format |
|-----------|---------|---------------|
| Suggestible | Any | `Malformed operator '< ='. Did you mean '<='?` |
| Invalid (general) | Any | `Invalid operator sequence '< \|'. This operator combination is not valid in Stata` |
| C-style `\| \|` | Qualifier | `Invalid operator sequence '\| \|'. Stata uses '\|' for logical OR, not '\|\|'` |
| C-style `& &` | Qualifier | `Invalid operator sequence '& &'. Stata uses '&' for logical AND, not '&&'` |
| C-style `\| \|` | Control flow | `C-style '\|\|' operator in if condition. Consider using '\|' for consistency with Stata style` |
| C-style `& &` | Control flow | `C-style '&&' operator in if condition. Consider using '&' for consistency with Stata style` |
| Compound assign `\| =` | Any | `Invalid operator sequence '\| ='. Stata does not support compound assignment operators` |

### Diagnostic Codes

Added to `StataDiagnosticCode` enum:

```typescript
// Malformed operator diagnostics (6xxx range)
MALFORMED_OPERATOR = 6001,
INVALID_OPERATOR_SEQUENCE = 6002,
CSTYLE_LOGICAL_IN_CONTROL_FLOW = 6003,
```

### Configuration Extension

#### Type Definition (`src/types/index.ts`)

Added to `StataLSPConfig.diagnostics.severity`:

```typescripttypescript
severity: {
    undefinedMacro: 'error' | 'warning' | 'information' | 'hint' | 'off';
    undefinedVariable: 'error' | 'warning' | 'information' | 'hint' | 'off';
    styleWarnings: 'error' | 'warning' | 'information' | 'hint' | 'off';
    malformedOperator: 'error' | 'warning' | 'information' | 'hint' | 'off';       // NEW
    invalidOperatorSequence: 'error' | 'warning' | 'information' | 'hint' | 'off';  // NEW
    cStyleLogicalInControlFlow: 'error' | 'warning' | 'information' | 'hint' | 'off';  // NEW
};
```

Default values (in `DEFAULT_SETTINGS`):
- `malformedOperator`: `'warning'` — controls suggestible sequences (`< =` → `<=`)
- `invalidOperatorSequence`: `'error'` — controls invalid sequences (`< |`, etc.)
- `cStyleLogicalInControlFlow`: `'information'` — controls C-style logical operators (`&&`, `||`) in if/else if control flow statements

When either field is set to a specific severity, it overrides the corresponding default. When `'off'`, that category is suppressed. If all three are `'off'`, the analyzer returns `[]` immediately.

#### Default Settings (`src/server-handlers.ts`)

Add `malformedOperator: 'warning'`, `invalidOperatorSequence: 'error'`, and `cStyleLogicalInControlFlow: 'information'` to `DEFAULT_SETTINGS.diagnostics.severity`.

#### Config Validator (`src/utils/config-validator.ts`)

Add validation for `diagnostics.severity.malformedOperator`, `diagnostics.severity.invalidOperatorSequence`, and `diagnostics.severity.cStyleLogicalInControlFlow` following the same pattern as `undefinedMacro`, `undefinedVariable`, and `styleWarnings` — check against `valid_severities` and copy to `validated_config`.

Note: `src/utils/workspace-config.ts` does not need changes. Severity settings come through VS Code's `getConfiguration` path, not `.sight.json`. The existing severity fields (`undefinedMacro`, etc.) follow the same pattern.

#### VS Code Extension Settings (`client/package.json`)

Add three new entries to `contributes.configuration.properties`, following the same pattern as the existing severity settings:

```json
"sight.diagnostics.severity.malformedOperator": {
    "type": "string",
    "enum": ["error", "warning", "information", "hint", "off"],
    "default": "warning",
    "description": "Severity level for spaced compound operator diagnostics (e.g., '< =' instead of '<='). Set to 'off' to disable.",
    "enumDescriptions": [
        "Show as error",
        "Show as warning",
        "Show as information",
        "Show as hint",
        "Disable this diagnostic"
    ]
},
"sight.diagnostics.severity.invalidOperatorSequence": {
    "type": "string",
    "enum": ["error", "warning", "information", "hint", "off"],
    "default": "error",
    "description": "Severity level for invalid operator sequence diagnostics (e.g., '< |'). Set to 'off' to disable.",
    "enumDescriptions": [
        "Show as error",
        "Show as warning",
        "Show as information",
        "Show as hint",
        "Disable this diagnostic"
    ]
},
"sight.diagnostics.severity.cStyleLogicalInControlFlow": {
    "type": "string",
    "enum": ["error", "warning", "information", "hint", "off"],
    "default": "information",
    "description": "Severity level for C-style logical operators (&&, ||) in if/else if control flow statements. These operators work in control flow but are stylistically discouraged. Set to 'off' to disable.",
    "enumDescriptions": [
        "Show as error",
        "Show as warning",
        "Show as information",
        "Show as hint",
        "Disable this diagnostic"
    ]
}
```

#### README Documentation (`README.md`)

Add rows to the diagnostics settings table:

```markdown
| `sight.diagnostics.severity.malformedOperator` | enum | `"warning"` | Severity for spaced compound operator diagnostics (e.g., `< =` → `<=`). Options: `"error"`, `"warning"`, `"information"`, `"hint"`, `"off"` |
| `sight.diagnostics.severity.invalidOperatorSequence` | enum | `"error"` | Severity for invalid operator sequence diagnostics (e.g., `< |`). Options: `"error"`, `"warning"`, `"information"`, `"hint"`, `"off"` |
| `sight.diagnostics.severity.cStyleLogicalInControlFlow` | enum | `"information"` | Severity for C-style logical operators (`&&`, `||`) in if/else if control flow statements. These work but are stylistically discouraged. Options: `"error"`, `"warning"`, `"information"`, `"hint"`, `"off"` |
```

Also add a brief section in the diagnostics documentation explaining what malformed operator diagnostics detect (spaced compound operators, invalid operator combinations, and context-aware C-style logical operator handling).

## Data Models

### OperatorPairResult

Internal classification result for an operator pair:

```typescript
interface OperatorPairResult {
    kind: 'suggestible' | 'invalid' | 'cstyle_control_flow';
    first_token: Token;
    second_token: Token;
    pair_key: string;        // e.g., '< ='
    message: string;         // Full diagnostic message
    default_severity: DiagnosticSeverity;  // Warning for suggestible, Error for invalid, Information for cstyle_control_flow
    code: StataDiagnosticCode;
}
```

### Diagnostic Output

Each result maps to a standard LSP `Diagnostic`. The `'off'` config value is handled by an early-exit check before classification (if all three categories are `'off'`, return `[]`; if only some are `'off'`, skip results of those kinds). The severity mapping for non-`'off'` values uses a helper that converts config strings to `DiagnosticSeverity` enums:

```typescripttypescript
// resolve_severity converts a config string to DiagnosticSeverity,
// using the result's default_severity as fallback if config is undefined.
function get_config_severity(result: OperatorPairResult, config: StataLSPConfig): string | undefined {
    switch (result.kind) {
        case 'suggestible':
            return config.diagnostics.severity.malformedOperator;
        case 'invalid':
            return config.diagnostics.severity.invalidOperatorSequence;
        case 'cstyle_control_flow':
            return config.diagnostics.severity.cStyleLogicalInControlFlow;
    }
}

const my_severity = resolve_severity(
    get_config_severity(result, config),
    result.default_severity,
);

{
    range: {
        start: first_token.range.start,
        end: second_token.range.end,
    },
    message: result.message,
    severity: my_severity,
    source: 'sight',
    code: result.code,
}
```


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Suggestible pair detection and diagnostics

*For any* suggestible operator pair (`< =`, `> =`, `! =`, `~ =`, `= =`) embedded in valid Stata code as adjacent OPERATOR tokens, the analyzer should emit exactly one diagnostic with: (a) severity Warning, (b) code `MALFORMED_OPERATOR` (6001), (c) a message matching `"Malformed operator '<op1> <op2>'. Did you mean '<compound>'?"`, and (d) a range spanning from the start of the first token to the end of the second token.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 5.1, 5.3, 9.2**

### Property 2: Invalid pair detection and diagnostics

*For any* invalid operator pair (from the set: `< |`, `< &`, `> |`, `> &`, `| <`, `| >`, `& <`, `& >`, `| =`, `| &`, `& |`, `< <`, `> >`, `< >`, `> <`) embedded in valid Stata code as adjacent OPERATOR tokens, the analyzer should emit exactly one diagnostic with: (a) severity Error, (b) code `INVALID_OPERATOR_SEQUENCE` (6002), (c) a message containing the specific pair string, and (d) for `| =`, the message should note that Stata does not support compound assignment operators.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 5.2, 5.3, 5.9, 5.12, 9.3**

### Property 2a: C-style logical in if qualifier context

*For any* C-style logical operator pair (`| |`, `& &`) appearing in an if qualifier context (e.g., `gen x = 1 if a == 1 && b == 1`), the analyzer should emit exactly one diagnostic with: (a) severity Error, (b) code `INVALID_OPERATOR_SEQUENCE` (6002), (c) a message noting that Stata uses single `|` or `&` for logical operations.

**Validates: Requirements 2.6, 5.10, 5.11, 9.3**

### Property 2b: C-style logical in if control flow context

*For any* C-style logical operator pair (`| |`, `& &`) appearing in an if or else if control flow statement condition (e.g., `if a == 1 && b == 1 { ... }`), the analyzer should: (a) NOT emit an error diagnostic, (b) when `cStyleLogicalInControlFlow` config is not `'off'`, emit an informational diagnostic with code `CSTYLE_LOGICAL_IN_CONTROL_FLOW` (6003) and a message suggesting the use of single operators for consistency.

**Validates: Requirements 2a.1, 2a.2, 5.13, 5.14, 9.4**

### Property 3: Embedded context suppression

*For any* malformed operator pair (suggestible or invalid) placed inside a Mata or Python embedded block, the analyzer should emit zero diagnostics for that pair.

**Validates: Requirements 3.1, 3.2**

### Property 4: No false positives for allowed adjacencies

*For any* pair of adjacent OPERATOR tokens where the combination is in the allowlist (comparison + arithmetic in either order, or negation before comparison), the analyzer should emit zero diagnostics.

**Validates: Requirements 4.3, 4.4**

Note: Requirement 4.1 (non-adjacent operators separated by non-operator tokens) is a structural guarantee of the adjacency detection algorithm — non-operator tokens between two operators prevent them from being considered adjacent, so they are never classified. Requirement 4.2 (compound operators without spaces) is a lexer-level guarantee — the lexer produces a single token, not a pair.

### Property 5: Continuation-spanning detection

*For any* malformed operator pair where the first operator is on one line and the second is on the next line connected by a `///` continuation, the analyzer should still detect and emit a diagnostic for the pair.

**Validates: Requirements 6.1**

### Property 6: Statement terminator boundary

*For any* two operators separated by a statement terminator (newline in CR mode or `;` in semicolon mode), the analyzer should emit zero diagnostics, even if the pair would otherwise be malformed.

**Validates: Requirements 6.2**

### Property 7: Directive suppression

*For any* malformed operator pair on a line annotated with `@lsp-ignore` (same line) or targeted by `@lsp-ignore-next` (preceding comment line), the analyzer should emit zero diagnostics for that pair.

**Validates: Requirements 7.1, 7.2**

### Property 8: Config severity override (suggestible)

*For any* suggestible operator pair and any `malformedOperator` config severity value (`'error'`, `'warning'`, `'information'`, `'hint'`), the emitted diagnostic should use the configured severity. When `malformedOperator` is `'off'`, zero suggestible diagnostics should be emitted.

**Validates: Requirements 8.1, 8.3, 8.5, 8.6**

### Property 9: Config severity override (invalid)

*For any* invalid operator pair and any `invalidOperatorSequence` config severity value (`'error'`, `'warning'`, `'information'`, `'hint'`), the emitted diagnostic should use the configured severity. When `invalidOperatorSequence` is `'off'`, zero invalid diagnostics should be emitted.

**Validates: Requirements 8.2, 8.4, 8.5, 8.7**

### Property 10: Config severity override (C-style in control flow)

*For any* C-style logical operator pair in an if/else if control flow context and any `cStyleLogicalInControlFlow` config severity value (`'error'`, `'warning'`, `'information'`, `'hint'`), the emitted diagnostic should use the configured severity. When `cStyleLogicalInControlFlow` is `'off'`, zero diagnostics should be emitted for C-style logical operators in control flow contexts.

**Validates: Requirements 2a.3, 2a.4, 8.8, 8.9, 8.10**

## Error Handling

The `OperatorSequenceAnalyzer` is a pure diagnostic analyzer with no external I/O. Error handling is minimal:

- **Missing tokens**: If `document.tokens` is empty or undefined, return `[]`.
- **Missing AST**: If `document.ast` is unavailable, treat all C-style logical operators as invalid (qualifier context). This is a defensive fallback — in practice, `DocumentState` always has an AST.
- **Missing context tracker**: If `document.context_tracker` is unavailable, skip embedded context filtering (analyze all tokens). This is a defensive fallback — in practice, `DocumentState` always has a context tracker.
- **Missing `ignored_lines`**: If `document.ignored_lines` is undefined, treat as empty (no suppression). This handles edge cases where the semantic analyzer hasn't run yet.
- **Config missing fields**: If `malformedOperator` is absent, fall back to `'warning'`. If `invalidOperatorSequence` is absent, fall back to `'error'`. If `cStyleLogicalInControlFlow` is absent, fall back to `'information'`. The `DEFAULT_SETTINGS` ensures all fields are always present in validated configs.
- **Malformed token ranges**: If a token has an invalid range (e.g., end before start), skip that pair. This should never happen with a correct lexer but guards against corruption.

No exceptions are thrown. The analyzer always returns a `Diagnostic[]` (possibly empty).

## Testing Strategy

### Property-Based Testing (fast-check)

Each correctness property maps to a single property-based test with minimum 100 iterations. Tests use `fast-check` generators to produce:

- Random suggestible/invalid operator pairs from the defined sets
- Random valid Stata expressions as context around the pairs
- Random whitespace/continuation trivia between operators
- Random embedded block wrappers (Mata/Python)
- Random `@lsp-ignore` / `@lsp-ignore-next` annotations
- Random config severity values
- Random if control flow statements vs if qualifier contexts for C-style logical operators

**Library**: `fast-check` (already used in the project)

**Test file**: `tests/property/operator-sequence-diagnostics.prop.test.ts`

Each test is tagged with:
```text
Feature: malformed-operator-diagnostics, Property N: <property_text>
```

### Unit Testing

Unit tests cover specific examples and edge cases:

- Exact message strings for each suggestible pair (Requirements 5.4–5.8)
- Exact message strings for C-style logical pairs in qualifier context (Requirements 5.10–5.11)
- Exact message strings for C-style logical pairs in control flow context (Requirements 5.13–5.14)
- Exact message string for `| =` compound assignment hint (Requirement 5.12)
- Exact message strings for general invalid pairs (Requirement 5.9)
- `DEFAULT_SETTINGS.diagnostics.severity.malformedOperator` equals `'warning'` (Requirement 8.6)
- `DEFAULT_SETTINGS.diagnostics.severity.invalidOperatorSequence` equals `'error'` (Requirement 8.7)
- `DEFAULT_SETTINGS.diagnostics.severity.cStyleLogicalInControlFlow` equals `'information'` (Requirement 8.9)
- `StataDiagnosticCode.MALFORMED_OPERATOR === 6001`, `INVALID_OPERATOR_SEQUENCE === 6002`, and `CSTYLE_LOGICAL_IN_CONTROL_FLOW === 6003` (Requirements 9.1–9.4)
- Compound operators without spaces produce single tokens (Requirement 4.2)
- Comments between operators break adjacency (no false positive for `x < /* */ = 1`)
- C-style logical in if control flow vs if qualifier context distinction

**Test file**: `tests/unit/operator-sequence-diagnostics.test.ts`

### Integration Testing

Integration tests verify the analyzer works correctly within the full `DiagnosticsProvider` pipeline:

- Malformed operator diagnostics appear alongside other diagnostic types
- Config changes propagate correctly through the provider
- Cache invalidation works when config changes
- Context-aware C-style logical operator handling in real code scenarios

**Test file**: `tests/integration/operator-sequence-diagnostics.test.ts`
