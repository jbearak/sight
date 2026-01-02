# Command Database System

## Overview

Fast, minimal command metadata system for Sight. Uses pre-generated JSON
caches with a simple type system for efficient command lookup and abbreviation
expansion.

## Type System

The system uses minimal types defined in `types.ts`:

```typescript
// Supported Stata versions
type StataVersion = 15 | 16 | 17 | 18;

// Core command information
interface CommandInfo {
    name: string;           // Full command name (e.g., "regress")
    syntax: string;         // Command syntax pattern
    description: string;    // Brief description
    min_abbreviation: number; // Minimum chars for valid abbreviation
}

// Cache structure loaded from JSON
interface CommandCache {
    version: StataVersion;
    commands: Record<string, CommandInfo>;  // name -> info
    abbreviations: Record<string, string>;  // abbrev -> full_name
}
```

## Cache Generation

Caches are generated manually using `scripts/generate-cache.ts` and committed
to the repository. This is the sole cache generation script.

```bash
# Generate full cache for Stata 18
bun scripts/generate-cache.ts 18

# Generate cache with custom output path
bun scripts/generate-cache.ts 18 src/command-database/caches/v18.json

# Generate test cache with limited commands (50)
bun scripts/generate-cache.ts 18 src/command-database/caches/test.json 50

# Generate for different Stata version
bun scripts/generate-cache.ts 17 src/command-database/caches/v17.json
```

**When to regenerate:**
- When supporting a new Stata version
- When command metadata extraction logic changes
- When adding new commands to the database

## API Usage

```typescript
import { CommandDatabase } from './src/command-database/index.js';
import cache from './src/command-database/caches/v18.json';

const db = new CommandDatabase();
db.load_cache(cache);

// Direct lookup by name
const regress = db.lookup_command('regress');

// Abbreviation lookup (automatic expansion)
const regress2 = db.lookup_command('reg'); // same result

// Search by prefix
const matches = db.search('reg'); // returns all commands starting with "reg"

// Expand abbreviation to all matching commands
const expanded = db.expand_abbreviation('reg');

// Get all commands
const all = db.get_all_commands();

// Check if command exists
const exists = db.has('regress');
```

## Files

| File | Purpose |
|------|---------|
| `types.ts` | Minimal type definitions (`CommandInfo`, `CommandCache`) |
| `index.ts` | `CommandDatabase` class with lookup/search/expand methods |
| `smcl-extractor.ts` | Extracts command metadata from Stata SMCL help files |
| `caches/*.json` | Pre-generated cache files (committed to repo) |

## Performance

- **Cache Generation**: ~3,440 SMCL files processed in parallel in seconds
- **Tests**: Unit tests run in ~7ms
- **Memory**: Minimal JSON cache files (~50KB for 50 commands)
- **Parallel Processing**: Files read concurrently using Promise.all

## Integration

1. Generate caches manually when Stata versions change
2. Commit cache files to repository
3. Load caches at runtime for fast lookups
4. No build-time processing needed

The `CommandDatabase` is used by LSP providers:
- **Completion provider**: Suggests commands based on prefix
- **Hover provider**: Shows command syntax
- **Diagnostics**: Validates command names
