# Design Document: Command Metadata System

## Overview

The Command Metadata System provides minimal, fast command recognition for the Stata LSP. It consists of:

1. **Manual Cache Generator**: A TypeScript script that processes SMCL help files and produces JSON metadata caches
2. **Runtime Command Database**: An in-memory store that loads bundled caches and provides fast lookup

The system prioritizes speed and simplicity over comprehensive parsing.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                   MANUAL GENERATION                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Stata Installation          Cache Generator Script              │
│  ┌──────────────┐           ┌─────────────────────┐             │
│  │ ado/base/    │           │                     │             │
│  │  ├─ a/       │──────────▶│   Minimal Parser    │             │
│  │  │  regress  │           │         │           │             │
│  │  │  .sthlp   │           │         ▼           │             │
│  │  ├─ b/       │           │   Cache Generator   │             │
│  │  └─ ...      │           │         │           │             │
│  └──────────────┘           └─────────┼───────────┘             │
│                                       │                          │
│                                       ▼                          │
│                             ┌─────────────────────┐             │
│                             │  JSON Cache File    │             │
│                             │  (commit to repo)   │             │
│                             └─────────────────────┘             │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      RUNTIME                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐    ┌──────────────────────────────────┐   │
│  │ Bundled Cache   │───▶│       Command Database           │   │
│  │ (v18.json)      │    │  ┌────────────────────────────┐  │   │
│  └─────────────────┘    │  │ Abbreviation Resolver      │  │   │
│                         │  └────────────────────────────┘  │   │
│                         │  ┌────────────────────────────┐  │   │
│                         │  │ Command Lookup             │  │   │
│                         │  └────────────────────────────┘  │   │
│                         └──────────────────────────────────┘   │
│                                        │                        │
│                                        ▼                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    LSP Providers                         │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐               │   │
│  │  │Completion│  │  Hover   │  │   ...    │               │   │
│  │  └──────────┘  └──────────┘  └──────────┘               │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. Cache Generator (`scripts/generate-cache.ts`)

Manual script that processes SMCL files in parallel and produces JSON caches.

```typescript
interface CacheGenerator {
    generate_cache(options: GenerateOptions): Promise<CommandCache>;
}

interface GenerateOptions {
    stata_path?: string;
    version: StataVersion;
    output_path: string;
    max_files?: number; // For testing
}
```

### 2. Command Database (`src/command-database/`)

Runtime component that loads caches and provides lookup.

```typescript
interface CommandDatabase {
    load_cache(cache: CommandCache): void;
    lookup_command(name: string): CommandInfo | null;
    get_all_commands(): CommandInfo[];
}
```

## Data Models

### CommandCache (JSON Schema)

```typescript
interface CommandCache {
    version: StataVersion;
    commands: Record<string, CommandInfo>;
    abbreviations: Record<string, string>; // abbrev -> full_name
}

interface CommandInfo {
    name: string;
    syntax: string;            // Basic syntax pattern
    description: string;       // Command description
    min_abbreviation: number;  // Minimum abbreviation length
}

type StataVersion = 15 | 16 | 17 | 18;
```

## Performance Characteristics

- **Cache Generation**: Processes 3,440+ SMCL files in parallel in seconds
- **Tests**: Unit tests complete in ~7ms
- **Memory**: Minimal JSON cache files (~50KB for 50 commands)
- **Lookup**: Command lookups complete in microseconds
- **Parallel Processing**: Files read concurrently for maximum efficiency

## Usage Workflow

1. **Generate Cache**: Run `bun scripts/generate-cache.ts` when needed
2. **Commit Cache**: Add generated JSON file to repository
3. **Load at Runtime**: LSP loads bundled cache for fast lookups
4. **No Build Processing**: No complex parsing during builds
