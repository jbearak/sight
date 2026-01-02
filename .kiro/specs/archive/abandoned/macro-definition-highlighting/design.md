# Design Document: Macro Definition Highlighting

## Overview

This design extends the TextMate grammar (`client/syntaxes/stata.tmLanguage.json`) to highlight macro names at their definition site. The implementation adds new grammar rules that capture macro names following `local`, `global`, `tempvar`, `tempname`, and `tempfile` commands, assigning them appropriate scope names for syntax highlighting.

## Architecture

The TextMate grammar uses a pattern-based approach where regular expressions match text and assign scope names. The current grammar already has a `commands-macro` section that matches macro-related commands. We will enhance this section to capture macro names as separate tokens.

### Current State

The existing `commands-macro` pattern:
```json
{
    "match": "\\b(loc(a(l)?)?|gl(o(b(a(l)?)?)?)?)\\b",
    "name": "keyword.macro.stata"
}
```

This only highlights the command keyword, not the macro name that follows.

### Target State

New patterns will use capture groups to separately highlight:
1. The command keyword (e.g., `local`, `global`)
2. The macro name being defined (e.g., `fruit`, `num_apples`)

## Components and Interfaces

### Grammar Rule Structure

TextMate grammars support two main pattern types:
1. **match patterns**: Single regex with optional captures
2. **begin/end patterns**: Multi-line constructs

For macro definitions, we'll use **match patterns with captures** since definitions are single-line constructs.

### New Grammar Rules

#### Local Macro Definition Rule

```json
{
    "match": "\\b(loc(a(l)?)?)\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\b",
    "captures": {
        "1": { "name": "keyword.macro.stata" },
        "4": { "name": "entity.name.variable.macro.local.stata" }
    }
}
```

This pattern:
- Matches `loc`, `loca`, or `local` followed by whitespace and an identifier
- Capture group 1: The command keyword
- Capture group 4: The macro name (group 4 because of nested optional groups)

#### Global Macro Definition Rule

```json
{
    "match": "\\b(gl(o(b(a(l)?)?)?)?)\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\b",
    "captures": {
        "1": { "name": "keyword.macro.stata" },
        "6": { "name": "entity.name.variable.macro.global.stata" }
    }
}
```

#### Temporary Name Definition Rules

```json
{
    "match": "\\b(tempvar|tempname|tempfile)\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\b",
    "captures": {
        "1": { "name": "keyword.macro.stata" },
        "2": { "name": "entity.name.variable.macro.temp.stata" }
    }
}
```

### Pattern Ordering

TextMate grammars apply patterns in order, with earlier patterns taking precedence. The new macro definition patterns must be placed **before** the existing simple keyword patterns to ensure the macro name is captured.

### Scope Name Design

Following TextMate conventions:
- `entity.name.variable` - Standard prefix for variable/identifier definitions
- `.macro` - Indicates this is a macro
- `.local` / `.global` / `.temp` - Distinguishes macro type
- `.stata` - Language suffix

This allows themes to:
- Style all macro definitions uniformly via `entity.name.variable.macro`
- Style by type via `entity.name.variable.macro.local` vs `.global`
- Style Stata-specific via the `.stata` suffix

## Data Models

No runtime data models are needed. The TextMate grammar is a static JSON configuration.

### Regex Capture Group Mapping

| Pattern | Group 1 | Group 2+ | Final Group |
|---------|---------|----------|-------------|
| `local` | `loc(a(l)?)?` | nested optionals | macro name |
| `global` | `gl(o(b(a(l)?)?)?)?` | nested optionals | macro name |
| `temp*` | command | - | macro name |



## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Macro Definition Name Highlighting

*For any* valid Stata macro name (starting with letter or underscore, followed by alphanumerics/underscores), when used in a `local` or `global` definition command, the TextMate grammar SHALL assign a scope containing `entity.name.variable.macro` to the macro name token.

**Validates: Requirements 1.1, 2.1**

### Property 2: Command Abbreviation Equivalence

*For any* valid abbreviation of `local` (`loc`, `loca`, `local`) or `global` (`gl`, `glo`, `glob`, `globa`, `global`), the macro name following the command SHALL receive the same scope as when using the full command form.

**Validates: Requirements 1.2, 2.2**

### Property 3: Local vs Global Scope Distinction

*For any* macro definition, the scope assigned to a local macro name SHALL differ from the scope assigned to a global macro name, specifically using `.local` vs `.global` in the scope path.

**Validates: Requirements 4.2**

### Property 4: Temp Command Name Highlighting

*For any* `tempvar`, `tempname`, or `tempfile` command followed by a valid macro name, the TextMate grammar SHALL assign a scope containing `entity.name.variable.macro.temp` to the macro name token.

**Validates: Requirements 3.1, 3.2, 3.3**

### Property 5: Dereference Highlighting Preservation

*For any* macro dereference syntax (`` `name' `` for locals, `$name` or `${name}` for globals), the TextMate grammar SHALL continue to assign scopes containing `variable.other.macro` to the dereference tokens.

**Validates: Requirements 5.1**

## Error Handling

TextMate grammars are declarative and don't have runtime errors. However, malformed patterns can cause:

1. **No match**: If a pattern doesn't match, the text falls through to subsequent patterns or remains unstyled
2. **Partial match**: Capture groups may not capture if optional parts don't match

### Edge Cases

| Case | Expected Behavior |
|------|-------------------|
| `local` with no name | Command keyword highlighted, no macro name |
| `local 123invalid` | Command highlighted, invalid name not highlighted as macro |
| `local _valid` | Both command and underscore-prefixed name highlighted |
| `local a b c` | Command and first name highlighted (TextMate limitation) |

### Limitation: Multiple Names

TextMate grammars cannot easily capture multiple variable-length names in a single match. For commands like `tempvar x y z`, only the first name will be highlighted. This is a known limitation of the TextMate grammar format.

## Testing Strategy

### Unit Tests

Unit tests will verify specific tokenization examples:
- Local definition with various abbreviations
- Global definition with various abbreviations
- Temp commands (tempvar, tempname, tempfile)
- Edge cases (no name, invalid name, assignment with `=`)

### Property-Based Tests

Property tests will use fast-check to generate:
- Random valid macro names and verify correct scope assignment
- Random command abbreviations and verify equivalence
- Existing dereference patterns to verify no regression

### Test Framework

- Use the existing TextMate grammar test infrastructure in `tests/unit/textmate-grammar.test.ts`
- Use vscode-textmate library for tokenization
- Property tests with fast-check for comprehensive coverage

### Test Configuration

- Minimum 100 iterations per property test
- Tag format: **Feature: macro-definition-highlighting, Property {number}: {property_text}**
