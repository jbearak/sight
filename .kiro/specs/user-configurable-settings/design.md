# Design Document: User-Configurable Settings

## Overview

This design exposes the existing `StataLSPConfig` interface to users through VS Code's settings system. The implementation requires adding a `contributes.configuration` section to the extension's `package.json` that mirrors the `StataLSPConfig` type structure. The LSP server already has the infrastructure to receive and apply configuration changes—this feature simply makes those settings visible and editable by users.

## Architecture

The configuration flow follows the standard VS Code LSP pattern:

```
┌─────────────────────────────────────────────────────────────────┐
│                        VS Code                                   │
│  ┌─────────────┐    ┌──────────────┐    ┌───────────────────┐  │
│  │ Settings UI │───▶│ package.json │───▶│ Extension Client  │  │
│  │             │    │ contributes. │    │ (sends config to  │  │
│  │             │    │ configuration│    │  server)          │  │
│  └─────────────┘    └──────────────┘    └─────────┬─────────┘  │
└───────────────────────────────────────────────────┼─────────────┘
                                                    │
                                    workspace/configuration
                                                    │
                                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                       LSP Server                                 │
│  ┌──────────────────┐    ┌─────────────────────────────────┐   │
│  │ get_document_    │───▶│ validate_comment_formatting_    │   │
│  │ settings()       │    │ config()                        │   │
│  └──────────────────┘    └─────────────────────────────────┘   │
│           │                                                     │
│           ▼                                                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Providers (diagnostics, completion, formatting, etc.)     │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Package.json Configuration Schema

The `contributes.configuration` section defines all user-visible settings:

```json
{
  "contributes": {
    "configuration": {
      "title": "Stata Language Server",
      "properties": {
        "stata-lsp.diagnostics.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Enable or disable all diagnostics"
        },
        "stata-lsp.diagnostics.severity.undefinedMacro": {
          "type": "string",
          "enum": ["error", "warning", "information", "hint", "off"],
          "default": "warning",
          "description": "Severity level for undefined macro references"
        },
        "stata-lsp.diagnostics.severity.undefinedVariable": {
          "type": "string",
          "enum": ["error", "warning", "information", "hint", "off"],
          "default": "warning",
          "description": "Severity level for undefined variable references"
        },
        "stata-lsp.diagnostics.severity.styleWarnings": {
          "type": "string",
          "enum": ["error", "warning", "information", "hint", "off"],
          "default": "hint",
          "description": "Severity level for style warnings"
        },
        "stata-lsp.diagnostics.undefinedVariableEnabled": {
          "type": "boolean",
          "default": true,
          "description": "Enable checking for undefined variables"
        },
        "stata-lsp.completion.includeAbbreviations": {
          "type": "boolean",
          "default": true,
          "description": "Include command abbreviations in completions"
        },
        "stata-lsp.completion.includeSnippets": {
          "type": "boolean",
          "default": true,
          "description": "Include code snippets in completions"
        },
        "stata-lsp.formatting.indentSize": {
          "type": "number",
          "default": 4,
          "minimum": 1,
          "description": "Number of spaces or tab stops for indentation"
        },
        "stata-lsp.formatting.indentStyle": {
          "type": "string",
          "enum": ["spaces", "tabs"],
          "default": "spaces",
          "description": "Use spaces or tabs for indentation"
        },
        "stata-lsp.formatting.lineWidth": {
          "type": "number",
          "default": 80,
          "minimum": 40,
          "description": "Maximum line width for formatting"
        },
        "stata-lsp.formatting.preferredCommentStyle": {
          "type": "string",
          "enum": ["//", "*", "/* */"],
          "default": "//",
          "description": "Preferred comment style for normalization"
        },
        "stata-lsp.formatting.normalizeCommentStyle": {
          "type": "boolean",
          "default": false,
          "description": "Normalize comment styles during formatting"
        },
        "stata-lsp.formatting.commentLineWidth": {
          "type": "number",
          "default": 72,
          "minimum": 40,
          "description": "Maximum line width for comments"
        },
        "stata-lsp.indexing.maxFileSizeBytes": {
          "type": "number",
          "default": 524288,
          "description": "Maximum file size in bytes for indexing (default 512KB)"
        },
        "stata-lsp.indexWorkspace": {
          "type": "boolean",
          "default": true,
          "description": "Enable workspace-wide symbol indexing"
        },
        "stata-lsp.adoPaths": {
          "type": "array",
          "items": { "type": "string" },
          "default": [],
          "description": "Additional paths to search for ADO files"
        }
      }
    }
  }
}
```

### Existing Server Infrastructure

The server already handles configuration through these mechanisms:

1. **Configuration Request**: `get_document_settings()` in `server.ts` fetches settings via `connection.workspace.getConfiguration({ scopeUri, section: 'stata-lsp' })`

2. **Configuration Validation**: `validate_comment_formatting_config()` in `utils/config-validator.ts` validates and applies defaults

3. **Change Notification**: `onDidChangeConfiguration` handler clears cached settings and revalidates documents

4. **Default Settings**: `DEFAULT_SETTINGS` in `server-handlers.ts` provides fallback values

No server-side changes are required—the infrastructure is already in place.

## Data Models

No new data models required. The existing `StataLSPConfig` interface in `src/types/index.ts` already defines the complete configuration structure:

```typescript
export interface StataLSPConfig {
  diagnostics: {
    enabled: boolean;
    severity: {
      undefinedMacro: 'error' | 'warning' | 'information' | 'hint' | 'off';
      undefinedVariable: 'error' | 'warning' | 'information' | 'hint' | 'off';
      styleWarnings: 'error' | 'warning' | 'information' | 'hint' | 'off';
    };
    undefinedVariableEnabled: boolean;
  };
  completion: {
    includeAbbreviations: boolean;
    includeSnippets: boolean;
  };
  formatting: {
    indentSize: number;
    indentStyle: 'spaces' | 'tabs';
    lineWidth: number;
    preferredCommentStyle: '//' | '*' | '/* */';
    normalizeCommentStyle: boolean;
    commentLineWidth: number;
  };
  indexing: {
    maxFileSizeBytes: number;
  };
  adoPaths: string[];
  indexWorkspace: boolean;
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Configuration Schema Completeness

*For any* setting defined in `StataLSPConfig`, there SHALL exist a corresponding entry in `package.json` `contributes.configuration.properties` with:
- Matching type (boolean, number, string, array)
- Matching default value
- A non-empty description string

**Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 5.1, 7.1**

### Property 2: README Documentation Completeness

*For any* setting defined in `package.json` `contributes.configuration.properties`, there SHALL exist a corresponding entry in the README's configuration section with:
- The setting name
- The setting type
- The default value
- A description

**Validates: Requirements 8.1, 8.2, 8.3, 8.5**

### Property 2: Diagnostic Configuration Respected

*For any* valid `StataLSPConfig.diagnostics` configuration and any Stata source code, when diagnostics are computed:
- If `enabled` is `false`, no diagnostics SHALL be returned
- If a severity is set to `off`, diagnostics of that type SHALL not be returned
- If a severity is set to a level, diagnostics of that type SHALL have that severity

**Validates: Requirements 1.6**

### Property 3: Formatting Configuration Respected

*For any* valid `StataLSPConfig.formatting` configuration and any Stata source code, when formatting is applied:
- The indentation SHALL use the configured `indentStyle` and `indentSize`
- Lines SHALL not exceed `lineWidth` (where possible)
- If `normalizeCommentStyle` is `true`, comments SHALL use `preferredCommentStyle`

**Validates: Requirements 3.8**

### Property 4: Configuration Validation Idempotence

*For any* valid `StataLSPConfig` object, passing it through `validate_comment_formatting_config()` SHALL return an equivalent configuration (validation is idempotent for valid inputs).

**Validates: Requirements 6.2**

## Error Handling

### Invalid Configuration Values

The existing `validate_comment_formatting_config()` function handles invalid values by:
1. Logging a warning message via the connection console
2. Falling back to `DEFAULT_SETTINGS` for invalid fields
3. Preserving valid fields from the user's configuration

This ensures the server never operates with invalid configuration.

### Missing Configuration

If the client doesn't support configuration (older VS Code versions), the server falls back to `DEFAULT_SETTINGS` via the `has_configuration_capability` check in `get_document_settings()`.

## Testing Strategy

### Unit Tests

Unit tests verify specific examples and edge cases:

1. **Package.json Schema Tests**: Verify each setting exists with correct type, default, and description
2. **Configuration Validation Tests**: Test `validate_comment_formatting_config()` with edge cases:
   - Missing fields
   - Invalid enum values
   - Out-of-range numbers
   - Wrong types

### Property-Based Tests

Property tests verify universal properties across all inputs using fast-check:

1. **Schema Completeness Property**: Generate all paths in `StataLSPConfig` type and verify corresponding `package.json` entries
2. **Diagnostic Config Property**: Generate random valid configs and source code, verify diagnostics respect config
3. **Formatting Config Property**: Generate random valid configs and source code, verify formatting respects config
4. **Validation Idempotence Property**: Generate random valid configs, verify `validate(validate(config)) === validate(config)`

Configuration: Minimum 100 iterations per property test.

Tag format: **Feature: user-configurable-settings, Property {number}: {property_text}**

