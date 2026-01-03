# Design Document: Configurable Formatter Mode

## Overview

This design adds a user-configurable formatter mode setting that allows switching between the source-preserving formatter (default, safe) and the AST-based PrettyPrinter (experimental). The source-preserving formatter remains the default for everyday use, while the AST-based formatter can be enabled for testing and validating AST correctness.

## Architecture

```
                    ┌─────────────────────────┐
                    │   VS Code Settings      │
                    │ sight.formatting.mode   │
                    └───────────┬─────────────┘
                                │
                                ▼
                    ┌─────────────────────────┐
                    │     CodeFormatter       │
                    │   (mode dispatcher)     │
                    └───────────┬─────────────┘
                                │
              ┌─────────────────┴─────────────────┐
              │                                   │
              ▼                                   ▼
┌─────────────────────────┐         ┌─────────────────────────┐
│ SourcePreservingFormatter│         │     PrettyPrinter       │
│   (mode: "source-       │         │   (mode: "ast")         │
│    preserving")         │         │   [experimental]        │
│                         │         │                         │
│ - Token-based           │         │ - AST-based             │
│ - Only adjusts indent   │         │ - Full reconstruction   │
│ - Safe, no corruption   │         │ - Exercises parser      │
└─────────────────────────┘         └─────────────────────────┘
```

## Components and Interfaces

### Configuration Types

```typescript
// Add to StataLSPConfig.formatting
interface FormattingConfig {
    // ... existing fields ...
    mode: 'source-preserving' | 'ast';
}
```

### CodeFormatter Updates

The `CodeFormatter` class will be updated to dispatch to the appropriate formatter based on configuration:

```typescript
class CodeFormatter {
    format(
        document: DocumentState,
        options: FormattingOptions,
        config: StataLSPConfig
    ): TextEdit[] {
        const mode = config.formatting.mode || 'source-preserving';
        
        if (mode === 'ast') {
            return this.format_with_ast(document, options);
        }
        return this.format_with_source_preserving(document, options);
    }
    
    private format_with_ast(
        document: DocumentState,
        options: FormattingOptions
    ): TextEdit[];
    
    private format_with_source_preserving(
        document: DocumentState,
        options: FormattingOptions
    ): TextEdit[];
}
```

### VS Code Extension Configuration

Add to `client/package.json` contributes.configuration:

```json
{
    "sight.formatting.mode": {
        "type": "string",
        "enum": ["source-preserving", "ast"],
        "default": "source-preserving",
        "description": "Formatter mode. 'source-preserving' (default) safely adjusts indentation. 'ast' (experimental) uses AST-based formatting - useful for testing but may produce unexpected output."
    }
}
```

## Data Models

### Configuration Flow

1. User sets `sight.formatting.mode` in VS Code settings
2. Extension reads setting and passes to LSP server via `workspace/didChangeConfiguration`
3. Server stores mode in `StataLSPConfig.formatting.mode`
4. `CodeFormatter.format()` reads mode and dispatches accordingly

### Mode Behavior

| Mode | Formatter | Behavior | Use Case |
|------|-----------|----------|----------|
| `source-preserving` | SourcePreservingFormatter | Token-based, only adjusts indentation | Default, safe for production |
| `ast` | PrettyPrinter | AST reconstruction | Testing, AST validation |

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Mode Selection Correctness

*For any* valid formatter mode configuration ("source-preserving" or "ast"), the CodeFormatter SHALL use the corresponding formatter implementation.

**Validates: Requirements 1.3, 1.4**

### Property 2: Default Mode

*For any* formatting request where no mode is configured, the CodeFormatter SHALL use the source-preserving formatter.

**Validates: Requirements 1.5, 2.3**

### Property 3: AST Output Validity

*For any* valid Stata AST, the PrettyPrinter SHALL produce syntactically valid Stata code when invoked in AST mode.

**Validates: Requirements 3.3**

### Property 4: Error Handling - No Edits on Failure

*For any* formatting request in AST mode that encounters an error, the CodeFormatter SHALL return an empty array of TextEdits rather than corrupt the code.

**Validates: Requirements 4.1**

### Property 5: Error Handling - No Silent Fallback

*For any* formatting request in AST mode that fails, the CodeFormatter SHALL NOT automatically fall back to source-preserving mode, ensuring AST bugs are surfaced rather than hidden.

**Validates: Requirements 4.3**

### Property 6: Indent Size Preservation

*For any* formatting request with a configured indent size, the Source_Preserving_Formatter SHALL produce output using that exact indent size, not a different value.

**Validates: Requirements 5.1, 5.2, 5.3**

## Bug Fix: Source-Preserving Indentation

The source-preserving formatter has a bug where it changes 4-space indentation to 2 spaces. This needs to be fixed.

### Root Cause Analysis

The `IndentationAnalyzer` or `TokenReconstructor` may be:
1. Hardcoding an indent size instead of using the configured value
2. Not properly passing the indent size through the formatting pipeline
3. Using a default value that differs from the user's configuration

### Fix Approach

1. Trace the indent size from `FormattingOptions.tabSize` through to the final output
2. Ensure `FormatterConfig.indent_size` is correctly passed to `TokenReconstructor`
3. Verify `TokenReconstructor.make_indent()` uses the configured size, not a hardcoded value

## Error Handling

### AST Mode Errors

When the PrettyPrinter encounters an error:
1. Log a warning with error details
2. Return empty `TextEdit[]` (no changes)
3. Do NOT fall back to source-preserving mode

This ensures AST bugs are visible to developers testing the experimental mode.

### Invalid Configuration

When an invalid mode value is provided:
1. Log a warning about the invalid value
2. Fall back to "source-preserving" (safe default)

## Testing Strategy

### Unit Tests

- Verify mode dispatching logic
- Verify default mode is "source-preserving"
- Verify invalid mode falls back to default
- Verify error handling returns empty edits

### Property-Based Tests

Property tests using fast-check:

1. **Mode selection property**: For all valid modes, correct formatter is used
2. **Default mode property**: When mode is undefined, source-preserving is used
3. **Error handling property**: AST errors return empty edits, not fallback output

### Test Configuration

- Property tests: minimum 100 iterations per property
- Test tag format: **Feature: restore-pretty-printer-formatting, Property {number}: {property_text}**
- Testing framework: fast-check
