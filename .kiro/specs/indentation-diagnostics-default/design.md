# Design Document: Indentation Diagnostics Default

## Overview

This design changes the default value of `diagnostics.indentation` from `true` to `false` and exposes the setting in VS Code's settings UI. The change involves three components:

1. **Server-side default** (`src/server-handlers.ts`): Change `DEFAULT_SETTINGS.diagnostics.indentation` from `true` to `false`
2. **VS Code settings schema** (`client/package.json`): Add `sight.diagnostics.indentation` to the `contributes.configuration.properties` section
3. **Documentation** (`README.md`): Update to explain the default and rationale

## Architecture

The change is minimal and localized to configuration defaults. No new components or interfaces are needed.

```
┌─────────────────────────────────────────────────────────────────┐
│                        VS Code Settings                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ sight.diagnostics.indentation: false (default)          │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     LSP Server (server-handlers.ts)              │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ DEFAULT_SETTINGS.diagnostics.indentation = false        │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              IndentationDiagnosticAnalyzer                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ if (config.diagnostics.indentation === false) return [] │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Modified Files

#### 1. `src/server-handlers.ts`

Change the `DEFAULT_SETTINGS` constant:

```typescript
export const DEFAULT_SETTINGS: StataLSPConfig = {
    diagnostics: {
        enabled: true,
        severity: {
            undefinedMacro: 'warning',
            undefinedVariable: 'information',
            styleWarnings: 'hint',
        },
        undefinedVariableEnabled: false,
        indentation: false,  // Changed from true to false
    },
    // ... rest unchanged
};
```

#### 2. `client/package.json`

Add the setting to `contributes.configuration.properties`:

```json
{
  "sight.diagnostics.indentation": {
    "type": "boolean",
    "default": false,
    "description": "Enable indentation diagnostics (missing/unnecessary indentation warnings). Disabled by default since indentation is stylistic in Stata and doesn't affect execution."
  }
}
```

#### 3. `README.md`

Update the Examples section (near the "Missing indentation" screenshot):

```markdown
#### Missing indentation

> **Note:** Indentation diagnostics are disabled by default. See [Configuration](#diagnostics) to enable them.

<img width="" height="345" src="examples/missing_indentation.png"/>
```

Update the Configuration > Diagnostics table to change the default from `true` to `false`:

```markdown
| `sight.diagnostics.indentation` | boolean | `false` | Enable indentation diagnostics... |
```

Add explanation in the Configuration section after the Diagnostics table:

```markdown
#### Why Indentation Diagnostics Are Disabled by Default

Unlike Python, Stata ignores indentation - it's purely stylistic and doesn't affect code execution. Indentation diagnostics are disabled by default for several reasons:

1. **Stylistic, not semantic**: "Wrong" indentation won't break your code
2. **Legacy codebase noise**: Existing codebases may produce many warnings, causing alert fatigue
3. **Subjective preferences**: Teams may have different indentation conventions
4. **Opt-in philosophy**: Mature LSPs (TypeScript, ESLint) default stylistic rules to off

To enable indentation diagnostics:
- **VS Code**: Set `sight.diagnostics.indentation` to `true` in Settings
- **Project config**: Add `"diagnostics": { "indentation": true }` to `.sight.json`
```

Update the `.sight.json` example to show `false` as the default:

```json
{
  "diagnostics": {
    "indentation": false
  },
  // ...
}
```

## Data Models

No changes to data models. The existing `StataLSPConfig.diagnostics.indentation` boolean field is unchanged.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system - essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Default config disables indentation diagnostics

*For any* Stata source code with indentation issues, when analyzed with the default configuration (no user overrides), the `IndentationDiagnosticAnalyzer` SHALL produce zero indentation diagnostics.

**Validates: Requirements 1.1, 1.2**

### Property 2: Enabled config produces indentation diagnostics

*For any* Stata source code with intentional indentation issues (e.g., code inside a block with no indentation), when analyzed with `diagnostics.indentation` set to `true`, the `IndentationDiagnosticAnalyzer` SHALL produce at least one indentation diagnostic.

**Validates: Requirements 1.3**

### Property 3: Config setting controls diagnostic emission

*For any* Stata source code with indentation issues, the presence or absence of indentation diagnostics SHALL be determined solely by the `diagnostics.indentation` config value: `true` produces diagnostics, `false` produces none.

**Validates: Requirements 1.2, 1.3, 3.2**

## Error Handling

No new error handling required. The existing config validation in `config-validator.ts` already handles boolean validation for the `indentation` field.

## Testing Strategy

### Unit Tests

1. **Default value verification**: Verify `DEFAULT_SETTINGS.diagnostics.indentation === false`
2. **VS Code schema verification**: Verify `client/package.json` contains the setting with correct type and default

### Property-Based Tests

Property tests should use the existing `IndentationDiagnosticAnalyzer` test infrastructure:

1. **Property 1 & 3**: Generate random Stata code with blocks (if/foreach/while), run analyzer with default config, verify zero indentation diagnostics
2. **Property 2**: Generate Stata code with intentional indentation issues, run analyzer with `indentation: true`, verify diagnostics are produced

The existing property test `tests/property/formatter-resolves-indentation-diagnostics.prop.test.ts` provides a template for generating code with indentation issues.

### Manual Testing

1. Open VS Code Settings, search for "indentation" - verify `sight.diagnostics.indentation` appears
2. Open a Stata file with indentation issues - verify no warnings by default
3. Enable the setting - verify warnings appear
4. Disable the setting - verify warnings disappear
