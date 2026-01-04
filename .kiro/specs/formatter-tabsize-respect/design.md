# Design Document

## Overview

This design addresses the bug where the formatter's `IndentationAnalyzer` uses a hardcoded `indent_size = 4` instead of respecting the user's configured `tabSize`. The fix involves passing the `indent_size` from `FormatterConfig` to the `IndentationAnalyzer` so that indentation deltas are calculated correctly for any tab size.

## Architecture

The current data flow is:

```
FormattingOptions (tabSize) 
    → CodeFormatter 
    → FormatterConfig (indent_size) 
    → SourcePreservingFormatter 
    → IndentationAnalyzer (hardcoded indent_size = 4) ❌
    → TokenReconstructor (uses config.indent_size) ✓
```

The fix changes the flow to:

```
FormattingOptions (tabSize) 
    → CodeFormatter 
    → FormatterConfig (indent_size) 
    → SourcePreservingFormatter 
    → IndentationAnalyzer (uses config.indent_size) ✓
    → TokenReconstructor (uses config.indent_size) ✓
```

## Components and Interfaces

### IndentationAnalyzer Changes

The `IndentationAnalyzer` class needs to accept `indent_size` as a configuration parameter instead of using a hardcoded value.

**Option A: Constructor parameter**
```typescript
export class IndentationAnalyzer {
    private indent_size: number;
    
    constructor(indent_size: number = 4) {
        this.indent_size = indent_size;
    }
}
```

**Option B: Analyze method parameter**
```typescript
analyze(ast: StataAST, tokens?: Token[], alignment_info?: Map<number, ContinuationGroup>, original_source?: string, indent_size?: number): Map<number, IndentationInfo> {
    this.indent_size = indent_size ?? 4;
    // ...
}
```

**Decision: Option A (Constructor parameter)**

Rationale:
- The indent_size is a configuration value that doesn't change between calls
- Constructor injection is cleaner and makes the dependency explicit
- Matches the pattern used by `TokenReconstructor` which receives config

### SourcePreservingFormatter Changes

Pass `indent_size` from config to `IndentationAnalyzer`:

```typescript
constructor(config: FormatterConfig) {
    this.config = config;
    this.indentation_analyzer = new IndentationAnalyzer(config.indent_size);
    // ...
}
```

## Data Models

No changes to data models required. The existing `FormatterConfig` interface already includes `indent_size`:

```typescript
export interface FormatterConfig {
    indent_size: number;
    indent_style: 'spaces' | 'tabs';
    preserve_alignment?: boolean;
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Indentation Depth Correctness

*For any* valid tabSize (1-8) and any nesting depth, the formatter SHALL indent content at exactly `depth * tabSize` spaces.

**Validates: Requirements 1.2, 2.2, 2.3**

### Property 2: Formatting Idempotency

*For any* valid tabSize (1-8) and any valid Stata source code, formatting the output of formatting SHALL produce identical output: `format(format(source)) == format(source)`.

**Validates: Requirements 1.3**

### Property 3: Continuation Lines Don't Affect Block Depth

*For any* block (if, foreach, etc.) where the opening brace appears on a continuation line, the body content SHALL be indented at the correct block depth, not affected by the continuation.

**Validates: Requirements 2.1, 2.4**

## Error Handling

- If `indent_size` is not provided to `IndentationAnalyzer`, default to 4 for backward compatibility
- Invalid `indent_size` values (≤0) should be clamped to 1

## Testing Strategy

### Unit Tests

1. Test `IndentationAnalyzer` with various `indent_size` values (1, 2, 4, 8)
2. Test nested blocks with continuation lines in conditions
3. Test that the fix doesn't break existing formatting behavior with tabSize=4

### Property-Based Tests

Use fast-check to generate:
- Random tabSize values (1-8)
- Random nesting depths (1-5)
- Random Stata code with nested blocks and continuation lines

Verify the three correctness properties hold across all generated inputs.

### Regression Test

Add the specific reproduction case from the bug report:
- Nested if block with continuation lines in condition
- tabSize = 2
- Verify inner content is indented at 4 spaces (2 levels × 2 spaces)
