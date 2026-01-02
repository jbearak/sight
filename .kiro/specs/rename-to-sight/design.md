# Design Document: Rename to Sight

## Overview

This document describes the design for renaming the Stata LSP project from "stata-lsp" to "sight". The rename is a comprehensive refactoring that touches package manifests, VS Code extension configuration, internal source code references, documentation, and configuration file naming.

## Architecture

The rename follows a systematic approach across multiple layers:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Package Layer                                 │
│  package.json (name: "sight")                                   │
│  client/package.json (name: "sight-client")                     │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                VS Code Extension Layer                           │
│  Extension ID: "sight"                                          │
│  Configuration prefix: "sight.*"                                │
│  Commands: "sight.*"                                            │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                Configuration Layer                               │
│  Workspace config: .sight.json (was .stata-lsp.json)            │
│  Settings section: "sight" (was "stata-lsp")                    │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                Source Code Layer                                 │
│  Diagnostic source: "sight"                                     │
│  Log channel: "Sight Language Server"                           │
│  Internal references updated                                    │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Package Manifests

**Root package.json changes:**
- `name`: "stata-lsp" → "sight"
- `bin`: "stata-lsp" → "sight"
- `description`: Update to mention "Sight"

**Client package.json changes:**
- `name`: "stata-lsp-client" → "sight-client"
- `displayName`: "Stata Language Support" → "Sight - Stata Language Server"
- `repository.url`: Update if repository is renamed
- All `stata-lsp.*` configuration keys → `sight.*`
- All `stata-lsp.*` commands → `sight.*`

### VS Code Extension Configuration

The extension contributes configuration under a prefix. All settings change from `stata-lsp.*` to `sight.*`:

| Old Key | New Key |
|---------|---------|
| `stata-lsp.diagnostics.enabled` | `sight.diagnostics.enabled` |
| `stata-lsp.diagnostics.severity.undefinedMacro` | `sight.diagnostics.severity.undefinedMacro` |
| `stata-lsp.diagnostics.severity.undefinedVariable` | `sight.diagnostics.severity.undefinedVariable` |
| `stata-lsp.diagnostics.severity.styleWarnings` | `sight.diagnostics.severity.styleWarnings` |
| `stata-lsp.diagnostics.undefinedVariableEnabled` | `sight.diagnostics.undefinedVariableEnabled` |
| `stata-lsp.formatting.indentSize` | `sight.formatting.indentSize` |
| `stata-lsp.formatting.indentStyle` | `sight.formatting.indentStyle` |
| `stata-lsp.formatting.lineWidth` | `sight.formatting.lineWidth` |
| `stata-lsp.formatting.preferredCommentStyle` | `sight.formatting.preferredCommentStyle` |
| `stata-lsp.formatting.normalizeCommentStyle` | `sight.formatting.normalizeCommentStyle` |
| `stata-lsp.formatting.commentLineWidth` | `sight.formatting.commentLineWidth` |
| `stata-lsp.indexing.maxFileSizeBytes` | `sight.indexing.maxFileSizeBytes` |
| `stata-lsp.indexWorkspace` | `sight.indexWorkspace` |
| `stata-lsp.adoPaths` | `sight.adoPaths` |

### Commands

| Old Command | New Command |
|-------------|-------------|
| `stata-lsp.resetDepthColors` | `sight.resetDepthColors` |
| `stata-lsp.toggleLineComment` | `sight.toggleLineComment` |
| `stata-lsp.toggleBlockComment` | `sight.toggleBlockComment` |

### Configuration File

The workspace configuration file changes:
- `.stata-lsp.json` → `.sight.json`

The internal schema remains the same, only the filename changes.

### Source Code Changes

**Files requiring updates:**

1. `src/server.ts`:
   - Configuration section: `'stata-lsp'` → `'sight'`
   - Comments referencing `.stata-lsp.json` → `.sight.json`

2. `src/server-handlers.ts`:
   - Command names in `executeCommandProvider`
   - Command handling in `create_execute_command_handler`

3. `src/document-store.ts`:
   - Diagnostic `source` field: `'stata-lsp'` → `'sight'`

4. `src/providers/diagnostics.ts`:
   - Diagnostic `source` field: `'stata-lsp'` → `'sight'`

5. `src/utils/workspace-config.ts`:
   - Config file path: `.stata-lsp.json` → `.sight.json`
   - Function documentation updates

6. `src/providers/completion.ts`:
   - Workspace marker: `.stata-lsp.json` → `.sight.json`

7. `client/src/extension.ts`:
   - Output channel name: `'Stata Language Server'` → `'Sight Language Server'`
   - Command registration: `'stata-lsp.resetDepthColors'` → `'sight.resetDepthColors'`
   - Language client ID: `'stata-lsp'` → `'sight'`

### Documentation Updates

**Files requiring updates:**
- `README.md`: All references to "stata-lsp", configuration keys, file names
- `AGENTS.md`: Project name references, configuration file references
- `GEMINI.md`: Same as AGENTS.md (if it exists as a copy)

## Data Models

No data model changes are required. The rename is purely cosmetic/naming and does not affect the internal data structures.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Based on the prework analysis, the following properties were identified as testable:

### Property 1: Configuration Key Consistency

*For any* configuration key defined in `client/package.json` under `contributes.configuration.properties`, the key SHALL start with the "sight." prefix.

**Validates: Requirements 2.2, 3.1**

### Property 2: Diagnostic Source Attribution

*For any* diagnostic emitted by the LSP (from document-store.ts or diagnostics.ts), the `source` field SHALL be "sight".

**Validates: Requirements 4.3**

### Property 3: Command Identifier Consistency

*For any* command registered by the extension in `client/package.json` under `contributes.commands`, the command identifier SHALL start with the "sight." prefix.

**Validates: Requirements 2.3**

### Property 4: Configuration File Resolution

*For any* workspace with a `.sight.json` file in the root, the `read_workspace_file_config_from_root` function SHALL read and parse the configuration from that file.

**Validates: Requirements 6.1, 6.2**

## Error Handling

### Missing Configuration File

When `.sight.json` does not exist:
- Return empty partial config `{}`
- No error is logged (this is expected behavior)

### Invalid Configuration File

When `.sight.json` contains invalid JSON:
- Return empty partial config `{}`
- Log error message to console

### Backward Compatibility (Optional)

If backward compatibility is desired:
- Check for `.sight.json` first
- Fall back to `.stata-lsp.json` if `.sight.json` not found
- Log deprecation warning if legacy file is used

## Testing Strategy

### Unit Tests

Unit tests should verify:
1. Configuration keys are correctly prefixed with "sight."
2. Diagnostic source is "sight"
3. Command identifiers use "sight." prefix
4. Configuration file is read from `.sight.json`

### Property Tests

Property-based tests should verify:
1. All diagnostics have source "sight"
2. Configuration mapping works correctly with new file name
3. Command execution works with new command names

### Integration Tests

Integration tests should verify:
1. Extension activates correctly with new identifiers
2. Settings are read from VS Code configuration under "sight.*"
3. Workspace configuration is read from `.sight.json`

### Manual Testing Checklist

- [ ] Extension installs and activates
- [ ] Settings appear under "Sight" in VS Code settings
- [ ] Commands appear with "Sight:" prefix in command palette
- [ ] Diagnostics show "sight" as source
- [ ] `.sight.json` configuration is read correctly
