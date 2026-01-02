# Design Document: Option Completion Trigger

## Overview

This design documents a behavior change to improve the user experience when typing command options in Stata. Previously, users had to manually trigger completions (Ctrl+Space) after typing a comma to see available options. Now, completions appear automatically.

## Architecture

The change involves two components:

1. **Server Handlers** (`src/server-handlers.ts`): Reports trigger characters to the LSP client
2. **Completion Provider** (`src/providers/completion.ts`): Returns completions for option context

### Trigger Character Flow

```
User types comma → LSP client sees trigger character → Sends completion request → 
Completion Provider detects option context → Returns all options for command
```

## Components and Interfaces

### Server Capabilities

The `create_initialize_handler` function returns server capabilities including the trigger characters list:

```typescript
completionProvider: {
    triggerCharacters: [':', '`', '"', '$', '{', ',', ' '],
    resolveProvider: false,
}
```

### Completion Provider

The `get_option_completions` method no longer returns empty array for empty prefix. Instead, it returns all available options for the command, allowing users to browse options immediately after typing a comma.

## Data Models

No new data models required. The existing `CompletionItem` and `CommandInfo` types are sufficient.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Empty Option Prefix Returns All Options

*For any* command with defined options, when the cursor is in option context with an empty prefix (immediately after comma), the Completion_Provider shall return all available options for that command.

**Validates: Requirements 1.1, 2.1, 3.1**

### Property 2: Option Prefix Filtering

*For any* command with defined options and *for any* non-empty prefix string, all completion items returned by the Completion_Provider in option context shall have names that start with the prefix (case-insensitive match).

**Validates: Requirements 3.2**

### Property 3: Trigger Characters Configuration

The LSP Server shall report exactly the following trigger characters in its capabilities: `:`, `` ` ``, `"`, `$`, `{`, `,`, ` ` (7 characters total).

**Validates: Requirements 1.2, 2.2, 4.1**

## Error Handling

No special error handling required. If a command has no options, an empty array is returned (existing behavior).

## Testing Strategy

### Unit Tests

- Verify trigger characters list in server capabilities (Property 3)
- Verify empty prefix returns options for known commands

### Property-Based Tests

- Property 1: Generate random commands with options, verify empty prefix returns all options
- Property 2: Generate random prefixes, verify all returned options match the prefix

### Tests to Update or Remove

The following existing tests are now outdated and should be updated or removed:

1. `tests/unit/completion.test.ts` - "should return empty array for empty option prefix"
   - **Action**: Delete this test (contradicts new behavior)

2. `tests/property/empty-prefix-completions.prop.test.ts` - "immediately after comma returns empty completions"
   - **Action**: Delete this test (contradicts new behavior)

3. `tests/property/empty-prefix-completions.prop.test.ts` - "property: generated empty prefix positions return empty completions"
   - **Action**: Update to exclude option context from the "empty prefix returns empty" property

4. `tests/integration/lsp-lifecycle.test.ts` - trigger characters assertion
   - **Action**: Update expected trigger characters to include `,` and ` `
