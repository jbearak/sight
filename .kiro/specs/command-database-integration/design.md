# Design Document: Command Database Integration

## Overview

This design completes the integration of the new command database system into the Stata LSP. The work involves:
1. Regenerating the command cache with all commands (not just 50)
2. Adding validation that the new database is a superset of the legacy one
3. Fixing TypeScript compilation errors
4. Verifying all providers use the new database
5. Ensuring monotonic cache growth

## Architecture

The command database system follows this flow:

```
Stata Help Files (.sthlp)
        ↓
Cache Generator (scripts/generate-cache.ts)
        ↓
JSON Cache Files (src/command-database/caches/*.json)
        ↓
CommandDatabase class (src/command-database/index.ts)
        ↓
Providers (completion.ts, hover.ts)
```

## Components and Interfaces

### Cache Generator Enhancement

The existing `scripts/generate-cache.ts` needs enhancement:

```typescript
interface CacheGeneratorOptions {
    stata_version: StataVersion;
    output_path: string;
    max_commands?: number;  // For testing, omit for full generation
    force?: boolean;        // Override monotonicity check
}

interface GenerationResult {
    commands_generated: number;
    commands_previous: number;
    commands_added: number;
}
```

### Validation Test Interface

```typescript
interface SupersetValidation {
    legacy_commands: string[];
    new_commands: string[];
    missing_commands: string[];
    is_superset: boolean;
}
```

## Data Models

### Cache File Structure

The cache file structure remains unchanged:

```typescript
interface CommandCache {
    version: StataVersion;
    commands: Record<string, CommandInfo>;
    abbreviations: Record<string, string>;
}

interface CommandInfo {
    name: string;
    syntax: string;
    description: string;
    min_abbreviation: number;
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Legacy Database Superset

*For any* command that exists in the legacy database, that command SHALL also exist in the new command database.

**Validates: Requirements 1.2, 2.1**

### Property 2: Cache Monotonicity

*For any* existing cache file with N commands, running the cache generator (without --force) SHALL fail if the new cache would contain fewer than N commands.

**Validates: Requirements 6.2**

## Error Handling

### TypeScript Compilation Errors

The current errors are:
1. `onDidSave` - not a standard LSP method on the connection
2. `saveOptions` - not a valid server capability

**Resolution**: Remove these non-standard handlers. The `onDidSave` functionality was attempting to implement format-on-save, but this should be handled client-side.

### Cache Loading Errors

If cache loading fails:
1. Log a warning with the error details
2. Continue with an empty command database
3. Completions will be limited to user-defined programs and macros

## Testing Strategy

### Unit Tests

1. **Superset validation test**: Load both databases, verify all legacy commands exist in new
2. **TypeScript compilation test**: Run `tsc --noEmit` and verify exit code 0
3. **Import verification tests**: Grep source files for correct imports

### Property-Based Tests

1. **Legacy superset property**: For all commands in legacy database, verify existence in new database
2. **Monotonicity property**: Generate caches of varying sizes, verify smaller caches are rejected

### Integration Tests

1. **Build process test**: Run build, verify cache files copied to dist
2. **Cache loading test**: Verify server logs command count on startup

## Implementation Notes

### Fixing TypeScript Errors

Remove from `src/server.ts`:
```typescript
// Remove this handler - onDidSave is not standard LSP
connection.onDidSave((params) => {
    // ...
});
```

Remove from `src/server-handlers.ts`:
```typescript
// Remove saveOptions from capabilities
saveOptions: {
    includeText: false,
},
```

### Cache Generation

The current cache has only 50 commands because the generator was run with a limit for testing. To generate the full cache:

```bash
# Generate full cache (no limit)
bun scripts/generate-cache.ts 18 src/command-database/caches/v18.json
```

#### Parallel Processing Architecture

With thousands of .sthlp files to process, the generator must use efficient parallel processing:

```typescript
async function generate_cache(options: CacheGeneratorOptions): Promise<GenerationResult> {
    // 1. Discover all .sthlp files
    const the_help_files = await discover_help_files(stata_path);
    
    // 2. Process files in parallel batches
    const BATCH_SIZE = 100;  // Process 100 files concurrently
    const the_results: CommandInfo[] = [];
    
    for (let i = 0; i < the_help_files.length; i += BATCH_SIZE) {
        const my_batch = the_help_files.slice(i, i + BATCH_SIZE);
        const my_batch_results = await Promise.all(
            my_batch.map(file => extract_minimal_metadata(file))
        );
        the_results.push(...my_batch_results.filter(r => r !== null));
    }
    
    // 3. Collate results into cache structure
    return build_cache(the_results, options.stata_version);
}
```

#### Minimal Metadata Extraction

Each file should be processed with minimal parsing - only extract:
- Command name (from filename or title)
- Syntax pattern (first syntax line)
- Description (first description line)
- Minimum abbreviation length

```typescript
async function extract_minimal_metadata(file_path: string): Promise<CommandInfo | null> {
    // Read only the first ~1KB of the file for efficiency
    const my_content = await read_file_head(file_path, 1024);
    
    // Extract name from {title:...} or filename
    const name = extract_name(my_content, file_path);
    if (!name) return null;
    
    // Extract first syntax line
    const syntax = extract_first_syntax(my_content) || `${name} ...`;
    
    // Extract description
    const description = extract_description(my_content) || 'Stata command';
    
    return {
        name,
        syntax,
        description,
        min_abbreviation: calculate_min_abbreviation(name)
    };
}
```

This approach:
- Processes files in parallel batches (100 at a time)
- Reads only the first 1KB of each file
- Extracts only essential metadata
- Handles thousands of files in seconds, not minutes

### Monotonicity Check

Add to `scripts/generate-cache.ts`:

```typescript
function check_monotonicity(
    output_path: string, 
    new_count: number, 
    force: boolean
): void {
    if (!fs.existsSync(output_path)) return;
    
    const existing = JSON.parse(fs.readFileSync(output_path, 'utf-8'));
    const existing_count = Object.keys(existing.commands).length;
    
    if (new_count < existing_count && !force) {
        throw new Error(
            `Cache would shrink from ${existing_count} to ${new_count} commands. ` +
            `Use --force to override.`
        );
    }
}
```
