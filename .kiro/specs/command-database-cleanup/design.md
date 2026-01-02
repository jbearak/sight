# Design Document: Command Database Cleanup

## Overview

This design removes dead code from the command database system. Two parallel type systems emerged during development:

1. **Minimal system (in use)**: `types.ts` with simple `CommandInfo`, used by `generate-cache.ts` and runtime
2. **Elaborate system (dead)**: `cache-schema.ts` with `CommandMetadata` including version tracking, never fully implemented

The cleanup consolidates to the minimal system, removing ~500 lines of dead code.

## Architecture

### Current State (Before Cleanup)

```
┌─────────────────────────────────────────────────────────────────┐
│                    TWO PARALLEL SYSTEMS                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  MINIMAL (ACTIVE)              ELABORATE (DEAD)                  │
│  ┌──────────────┐              ┌──────────────────┐             │
│  │ types.ts     │              │ cache-schema.ts  │             │
│  │ CommandInfo  │              │ CommandMetadata  │             │
│  │ CommandCache │              │ AbbreviationDict │             │
│  └──────┬───────┘              └────────┬─────────┘             │
│         │                               │                        │
│         ▼                               ▼                        │
│  ┌──────────────┐              ┌──────────────────┐             │
│  │generate-cache│              │generate-command- │             │
│  │.ts (USED)    │              │cache.ts (UNUSED) │             │
│  └──────┬───────┘              └──────────────────┘             │
│         │                               │                        │
│         ▼                               ▼                        │
│  ┌──────────────┐              ┌──────────────────┐             │
│  │ v18.json     │              │ abbreviation-    │             │
│  │ (runtime)    │              │ builder.ts       │             │
│  └──────────────┘              └──────────────────┘             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Target State (After Cleanup)

```
┌─────────────────────────────────────────────────────────────────┐
│                    SINGLE MINIMAL SYSTEM                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐                                               │
│  │ types.ts     │                                               │
│  │ CommandInfo  │                                               │
│  │ CommandCache │                                               │
│  └──────┬───────┘                                               │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────┐                                               │
│  │generate-cache│                                               │
│  │.ts           │                                               │
│  └──────┬───────┘                                               │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────┐    ┌──────────────────────────────────┐       │
│  │ v18.json     │───▶│ CommandDatabase (index.ts)       │       │
│  └──────────────┘    │ - lookup()                       │       │
│                      │ - search()                       │       │
│                      │ - expand_abbreviation()          │       │
│                      └──────────────────────────────────┘       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Files to Delete

| File | Reason |
|------|--------|
| `src/command-database/cache-schema.ts` | Elaborate types never used at runtime |
| `src/command-database/abbreviation-builder.ts` | Uses elaborate types, not used by runtime |
| `src/command-database/abbreviation-resolver.ts` | Uses elaborate types, not used by runtime |
| `src/command-database/version-detector.ts` | Version detection not used (version tracking abandoned) |
| `scripts/generate-command-cache.ts` | Duplicate generator using elaborate types |

### Files to Modify

| File | Changes |
|------|---------|
| `src/command-database/index.ts` | Remove `CommandMetadata` export, remove `is_available_in_version()` |
| `tests/property/*.ts` | Update to use `CommandInfo` instead of `CommandMetadata` |
| `tests/unit/command-metadata-system.test.ts` | Update or remove tests using elaborate types |
| `tests/integration/lsp-providers-command-db.test.ts` | Update to use minimal types |

### Files to Keep Unchanged

| File | Reason |
|------|--------|
| `src/command-database/types.ts` | Core minimal types - already correct |
| `src/command-database/smcl-extractor.ts` | Used by active generator |
| `scripts/generate-cache.ts` | Active cache generator |

## Data Models

### Retained Types (from types.ts)

```typescript
export type StataVersion = 15 | 16 | 17 | 18;

export interface CommandInfo {
    name: string;
    syntax: string;
    description: string;
    min_abbreviation: number;
}

export interface CommandCache {
    version: StataVersion;
    commands: Record<string, CommandInfo>;
    abbreviations: Record<string, string>; // abbrev -> full_name
}
```

### Removed Types (from cache-schema.ts)

The following types will be deleted:
- `CommandMetadata` (with `introduced_version`, `deprecated_version`, `help_smcl`, etc.)
- `CommandSyntax`, `CommandOption`, `StoredResult`, `CrossReference`
- `AbbreviationDict` (Map-based structure)
- Serialization helpers

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Command Lookup Preservation

*For any* command name that exists in the v18.json cache, looking up that command after cleanup SHALL return the same `name`, `syntax`, `description`, and `min_abbreviation` values as before cleanup.

**Validates: Requirements 6.1**

### Property 2: Abbreviation Expansion Preservation

*For any* valid abbreviation in the cache's abbreviation dictionary, expanding that abbreviation after cleanup SHALL return the same full command name as before cleanup.

**Validates: Requirements 3.4, 6.2**

## Error Handling

### Compilation Errors

During cleanup, TypeScript compilation errors will occur as imports are removed. The cleanup must be done in order:

1. First, update test files to not depend on deleted types
2. Then, update `index.ts` exports
3. Finally, delete the dead code files

### Test Failures

Some tests explicitly test the elaborate schema (e.g., `cache-serialization-roundtrip.prop.test.ts`). These tests should be:
- Deleted if they only test dead code
- Updated if they test functionality that remains

## Testing Strategy

### Unit Tests

1. **Compilation verification**: Run `tsc --noEmit` to verify no TypeScript errors
2. **Import verification**: Grep for `cache-schema` imports, verify none exist
3. **Method removal verification**: Verify `is_available_in_version` doesn't exist in CommandDatabase

### Property-Based Tests

Property tests should use the minimal `CommandInfo` type. Tests that depend on `CommandMetadata` fields like `introduced_version` should be removed or rewritten.

**Property Test Configuration**:
- Use fast-check for property-based testing
- Minimum 100 iterations per property test
- Tag format: **Feature: command-database-cleanup, Property N: description**

### Integration Tests

1. **Cache loading test**: Verify v18.json loads successfully
2. **Lookup test**: Verify command lookup returns correct data
3. **Abbreviation test**: Verify abbreviation expansion works

## Implementation Notes

### Deletion Order

To avoid intermediate compilation errors, delete files in this order:

1. Update tests first (remove dependencies on dead code)
2. Update `index.ts` (remove exports)
3. Delete `cache-schema.ts`
4. Delete `abbreviation-builder.ts` and `abbreviation-resolver.ts`
5. Delete `version-detector.ts`
6. Delete `generate-command-cache.ts`

### Index.ts Changes

Remove this line:
```typescript
export type { CommandMetadata } from './cache-schema';
```

Remove this method:
```typescript
is_available_in_version(name: string, _target_version: StataVersion): boolean {
    const command = this.lookup_command(name);
    return command !== null;
}
```

### Test Updates

Tests using `CommandMetadata` need generators updated to use `CommandInfo`:

```typescript
// Before (elaborate)
const command_metadata_generator = fc.record({
    name: fc.string(),
    syntax: fc.array(syntax_generator),
    description: fc.string(),
    introduced_version: fc.constantFrom(15, 16, 17, 18),
    deprecated: fc.boolean(),
    // ... many more fields
});

// After (minimal)
const command_info_generator = fc.record({
    name: fc.string({ minLength: 1, maxLength: 20 }),
    syntax: fc.string(),
    description: fc.string(),
    min_abbreviation: fc.integer({ min: 1, max: 20 })
});
```
