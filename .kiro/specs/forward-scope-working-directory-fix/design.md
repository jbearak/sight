# Design Document: Forward Scope Working Directory Fix

## Overview

This design addresses a bug where forward calls (do/run/include commands) in parent files are resolved with incorrect working directories when the working directory is inherited from deeper ancestors in the directive chain.

The root cause is that when `follow_directives` parses a parent file, it doesn't yet know the working directory from deeper ancestors. The forward calls in that parent file are resolved relative to the parent file's directory instead of the effective working directory from the directive chain.

## Architecture

The fix requires a two-phase approach to avoid parsing files twice:

1. **Phase 1 (Lightweight)**: Recursively follow directive chain to discover working directory
   - Only parse directives from file headers (fast, no full AST)
   - Build the working directory context from deepest ancestor up
   
2. **Phase 2 (Full Parse)**: Parse files with the correct working directory already known
   - Full parse with correct working directory passed to analyzer
   - Forward calls resolved correctly on first parse

```
┌─────────────────────────────────────────────────────────────────┐
│                    Backward Resolution Flow                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  bh_vars.do                                                      │
│  └── @lsp-included-by survey.do                                  │
│       │                                                          │
│       ▼                                                          │
│  survey.do                                                       │
│  └── @lsp-done-by loop.do                                        │
│       │                                                          │
│       ▼                                                          │
│  loop.do                                                         │
│  └── @lsp-working-directory: ".."  (resolves to fertility_surveys/)│
│                                                                  │
│  Phase 1: Discover working directory (directives only)           │
│  loop.do → survey.do → bh_vars.do                                │
│                                                                  │
│  Phase 2: Full parse with correct working directory              │
│  Forward calls in survey.do use fertility_surveys/               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Key Insight

The DirectiveParser already extracts directives from file headers quickly without full lexing/parsing. We can use this to:
1. Read file content once
2. Extract directives (lightweight) to follow the chain and discover working directory
3. Then do full parse with correct working directory context

## Components and Interfaces

### Modified: ScopeResolver.follow_directives

The `follow_directives` method needs to be restructured into two phases:

**Phase 1: Discover Working Directory (New helper method)**
```typescript
private async discover_working_directory(
    directives: Directive[],
    visited: Set<string>,
    depth: number,
    config: ScopeResolverConfig
): Promise<string | undefined>
```

This method:
- Reads file content from disk
- Uses DirectiveParser to extract only directives and working_directory (fast)
- Recursively follows directive chain to find working directory
- Returns the effective working directory for the chain

**Phase 2: Full Parse with Correct Context**
```typescript
// In follow_directives, after discovering working directory:
const effective_wd = await this.discover_working_directory(...);
const my_parent_result = await this.get_parsed_file(
    my_parent_uri, 
    my_directive.path,
    { working_directory: effective_wd }  // Pass discovered working directory
);
```

```typescript
// Current flow (buggy):
// 1. Parse parent file (forward calls resolved with wrong working directory)
// 2. Recurse to get working directory from deeper ancestors
// 3. Use working directory for forward resolution (too late!)

// Fixed flow:
// 1. Lightweight directive-only pass to discover working directory from chain
// 2. Full parse with correct working directory (forward calls resolved correctly)
// 3. No re-parsing needed!
```

### Modified: ScopeResolver.get_parsed_file

Already accepts `working_directory` option. The cache key already includes working directory. No changes needed.

### Modified: Analyzer.analyze

Already accepts `working_directory` in config. No changes needed.

## Data Models

No new data models required. The existing `ForwardCall` type already stores the resolved `path`.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Working Directory Inheritance for Forward Calls

*For any* directive chain where a deeper ancestor has a working directory, when resolving forward calls in an intermediate parent file, the forward call paths SHALL be resolved relative to the effective working directory from the directive chain, not relative to the parent file's directory.

**Validates: Requirements 1.1, 1.3, 2.2**

### Property 2: Own Working Directory Precedence

*For any* parent file that has its own @lsp-working-directory directive, when resolving forward calls in that file, the file's own working directory SHALL take precedence over any inherited working directory from deeper ancestors.

**Validates: Requirements 1.2**

### Property 3: Fallback to Script-Relative Resolution

*For any* directive chain where no working directory is set at any level, when resolving forward calls, the paths SHALL be resolved relative to the containing script's directory.

**Validates: Requirements 1.4**

### Property 4: Cache Key Includes Working Directory

*For any* file parsed with a working directory context, the cache key SHALL include the working directory, such that parsing the same file with a different working directory results in a cache miss and re-parse.

**Validates: Requirements 2.3, 4.1, 4.2**

### Property 5: Cache Invalidation Removes All Entries

*For any* file with multiple cache entries (due to different working directories), when the file is invalidated, ALL cache entries for that file SHALL be removed regardless of working directory.

**Validates: Requirements 4.3**

### Property 6: Error Diagnostics Include Tried Paths

*For any* forward call that cannot be resolved, the emitted diagnostic SHALL include the paths that were attempted during resolution.

**Validates: Requirements 3.2, 3.3**

## Error Handling

1. **File not found**: Continue to emit "Cannot read file" diagnostic with tried paths
2. **Circular dependencies**: Existing cycle detection remains unchanged
3. **Parse errors**: Existing error handling remains unchanged
4. **Cache inconsistencies**: Re-parsing with correct working directory handles this

## Testing Strategy

### Unit Tests

- Test `follow_directives` with directive chains that have working directories at various depths
- Test that re-parsing occurs when working directory is discovered from deeper ancestors
- Test cache key generation includes working directory
- Test cache invalidation removes all entries for a file

### Property-Based Tests

Property-based tests will use fast-check to generate:
- Random directive chains with working directories at various depths
- Random file structures with forward calls
- Random working directory values

Each property test should run minimum 100 iterations.

Test annotations should follow the format:
**Feature: forward-scope-working-directory-fix, Property N: [property text]**

### Integration Tests

- Test the specific scenario from the bug report:
  - `bh_vars.do` → `survey.do` → `loop.do` with working directory
  - Verify `dhs/year_recodes` resolves to `fertility_surveys/dhs/year_recodes`
