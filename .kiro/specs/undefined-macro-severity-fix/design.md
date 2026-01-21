# Design Document: Undefined Macro Severity Fix

## Overview

This design document describes the changes needed to fix the bug where `sight.diagnostics.severity.undefinedMacro` VS Code setting is ignored. The fix involves removing the redundant `crossFile.diagnostics.undefinedSymbol` setting entirely and updating the diagnostics provider to use only the VS Code-exposed individual severity settings.

## Architecture

The change affects the configuration flow and diagnostics severity determination:

```text
Before:
VS Code Settings → DEFAULT_SETTINGS (with undefined_symbol default) → DiagnosticsProvider
                                    ↓
                   cross_file.diagnostics.undefined_symbol always wins

After:
VS Code Settings → DEFAULT_SETTINGS (no undefined_symbol) → DiagnosticsProvider
                                    ↓
                   diagnostics.severity.undefinedMacro/undefinedVariable used directly
```

## Components and Interfaces

### 1. DEFAULT_SETTINGS (server-handlers.ts)

Remove `undefined_symbol` from the `cross_file.diagnostics` object:

```typescript
// Before
cross_file: {
    // ...
    diagnostics: {
        undefined_symbol: 'warning',  // REMOVE THIS
        out_of_scope: 'information',
        missing_file: 'warning',
    },
}

// After
cross_file: {
    // ...
    diagnostics: {
        out_of_scope: 'information',
        missing_file: 'warning',
    },
}
```

### 2. CrossFileConfig Type (types/index.ts)

Remove `undefined_symbol` from the diagnostics interface:

```typescript
// Before
diagnostics: {
    undefined_symbol: 'error' | 'warning' | 'information' | 'off';
    out_of_scope: 'error' | 'warning' | 'information' | 'off';
    missing_file: 'error' | 'warning' | 'information' | 'off';
    max_depth: 'error' | 'warning' | 'information' | 'off';
    call_site_identification?: 'error' | 'warning' | 'information' | 'off';
};

// After
diagnostics: {
    out_of_scope: 'error' | 'warning' | 'information' | 'off';
    missing_file: 'error' | 'warning' | 'information' | 'off';
    max_depth: 'error' | 'warning' | 'information' | 'off';
    call_site_identification?: 'error' | 'warning' | 'information' | 'off';
};
```

### 3. DiagnosticsProvider (providers/diagnostics.ts)

Update `convert_semantic_diagnostic` to use individual severity settings directly:

```typescript
// Before
const cross_file_undefined = config.cross_file?.diagnostics?.undefined_symbol;

switch (diagnostic.code) {
    case StataDiagnosticCode.UNDEFINED_MACRO:
    case StataDiagnosticCode.UNDEFINED_VARIABLE:
        if (cross_file_undefined === 'off') {
            return null;
        }
        if (cross_file_undefined) {
            severity = this.cross_file_severity_to_lsp(cross_file_undefined);
        } else {
            const fallback_severity = diagnostic.code === StataDiagnosticCode.UNDEFINED_MACRO
                ? config.diagnostics.severity.undefinedMacro
                : config.diagnostics.severity.undefinedVariable;
            severity = this.get_severity_from_config(fallback_severity);
        }
        break;
}

// After
switch (diagnostic.code) {
    case StataDiagnosticCode.UNDEFINED_MACRO:
    case StataDiagnosticCode.UNDEFINED_VARIABLE:
        const severity_setting = diagnostic.code === StataDiagnosticCode.UNDEFINED_MACRO
            ? config.diagnostics.severity.undefinedMacro
            : config.diagnostics.severity.undefinedVariable;
        severity = this.get_severity_from_config(severity_setting);
        break;
}
```

### 4. Workspace Config Mapping (utils/workspace-config.ts)

Remove the mapping for `undefinedSymbol`:

```typescript
// Before
if (typeof diags_obj.undefinedSymbol === 'string') {
    mapped.cross_file!.diagnostics!.undefined_symbol = normalize_severity(diags_obj.undefinedSymbol);
}

// After
// Remove this block entirely
```

### 5. Config Validator (utils/config-validator.ts)

Remove validation for `undefined_symbol`:

```typescript
// Before
if (
    cross_file.diagnostics.undefined_symbol &&
    valid_severities.includes(cross_file.diagnostics.undefined_symbol)
) {
    validated_config.cross_file.diagnostics.undefined_symbol = normalize_sev(cross_file.diagnostics.undefined_symbol) as any;
}

// After
// Remove this block entirely
```

### 6. README Documentation

Remove `crossFile.diagnostics.undefinedSymbol` from the configuration table and example.

## Data Models

No new data models are introduced. The `CrossFileConfig.diagnostics` interface is simplified by removing the `undefined_symbol` field.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Property 1: Undefined macro severity respects configuration
*For any* valid severity value ('error', 'warning', 'information', 'hint', 'off') set in `diagnostics.severity.undefinedMacro`, and *for any* Stata code containing undefined macro references, the diagnostics SHALL be displayed with the configured severity (or suppressed entirely if 'off').
**Validates: Requirements 1.1, 1.2, 1.3**

Property 2: Undefined variable severity respects configuration
*For any* valid severity value ('error', 'warning', 'information', 'hint', 'off') set in `diagnostics.severity.undefinedVariable`, and *for any* Stata code containing undefined variable references, the diagnostics SHALL be displayed with the configured severity (or suppressed entirely if 'off').
**Validates: Requirements 1.4, 1.5**

## Error Handling

No new error handling is required. The existing error handling for invalid severity values in `get_severity_from_config` remains unchanged.

## Testing Strategy

### Unit Tests

1. Test that `diagnostics.severity.undefinedMacro` setting is respected for each severity level
2. Test that `diagnostics.severity.undefinedVariable` setting is respected for each severity level
3. Test default behavior when no severity settings are configured
4. Test that 'off' severity suppresses diagnostics

### Property Tests

1. Property test that for all valid severity values, the correct LSP severity is returned
2. Property test that undefined macro and variable diagnostics use their respective settings independently

### Existing Test Updates

Update existing tests that reference `cross_file.diagnostics.undefined_symbol`:
- `tests/property/diagnostic-suppression.test.ts`
- `tests/property/rename-validation-comprehensive.prop.test.ts`
- `tests/property/config-mapping-type-safety.prop.test.ts`
- `tests/test-config-helper.ts`
- Various other test files that create config objects with `undefined_symbol`
