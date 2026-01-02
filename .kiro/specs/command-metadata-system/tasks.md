# Implementation Plan: Command Metadata System

## Overview

This implementation plan builds a minimal, fast command metadata system for the Stata LSP. The work focuses on manual cache generation, fast runtime lookups, and millisecond-level testing.

## Tasks

- [x] 1. Create minimal command metadata types
  - [x] 1.1 Create `src/command-database/types.ts` with minimal interfaces
    - CommandInfo, CommandCache, StataVersion types
    - _Requirements: 1.4_

- [x] 2. Implement fast command database
  - [x] 2.1 Create `src/command-database/index.ts`
    - Fast lookup methods: lookup_command, get_all_commands
    - Abbreviation resolution in lookup
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 3. Create manual cache generation script
  - [x] 3.1 Create `scripts/generate-cache.ts`
    - Stata installation path discovery
    - Minimal SMCL parsing (extract name, syntax, description)
    - Parallel file processing using Promise.all
    - Abbreviation dictionary building
    - JSON cache output
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [x] 4. Write fast unit tests
  - [x] 4.1 Create `tests/unit/command-database.test.ts`
    - Test command lookup (direct and abbreviated)
    - Test get_all_commands
    - Tests complete in <10ms
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 5. Generate test cache
  - [x] 5.1 Run cache generator with limited files for testing
    - Generate cache with 50 commands for fast testing
    - Verify cache structure and content
    - _Requirements: 1.6_

- [x] 6. Integration with LSP providers
  - [x] 6.1 Update completion provider to use new command database
    - CompletionProvider now imports and uses CommandDatabase from command-database/index.ts
    - _Requirements: 2.1, 2.2_
  - [x] 6.2 Add basic command completions
    - get_command_completions() uses command_db.get_all() and command_db.search()
    - _Requirements: 2.2, 2.3_
  - [x] 6.3 Test integration
    - Integration tests in tests/integration/lsp-providers-command-db.test.ts
    - _Requirements: 4.1, 4.2_

- [x] 7. Extended command database features
  - [x] 7.1 Create `src/command-database/cache-schema.ts`
    - Full CommandMetadata, CommandSyntax, CommandOption, StoredResult types
    - AbbreviationDict with serialization helpers
    - Cache validation function
    - _Requirements: 1.4, 3.1_
  - [x] 7.2 Create `src/command-database/abbreviation-builder.ts`
    - build_abbreviation_dict() for generating abbreviation dictionaries
    - Destructive command handling (clear, drop, etc.)
    - Minimum uniqueness calculation
    - _Requirements: 3.1, 3.2_
  - [x] 7.3 Create `src/command-database/abbreviation-resolver.ts`
    - AbbreviationResolver class for runtime abbreviation expansion
    - resolve(), get_abbreviations(), is_valid_abbreviation() methods
    - _Requirements: 3.2, 3.3_
  - [x] 7.4 Create `src/command-database/version-detector.ts`
    - VersionDetector class for detecting Stata version from source
    - detect_version(), get_effective_version() methods
    - _Requirements: 2.1_

- [x] 8. Property-based tests for command database
  - [x] 8.1 Create `tests/property/command-database-lookup.prop.test.ts`
    - Property tests for command lookup behavior
    - _Requirements: 4.3, 4.4_
  - [x] 8.2 Create `tests/property/command-database-abbreviation.prop.test.ts`
    - Property tests for abbreviation resolution
    - _Requirements: 3.3, 4.3_
  - [x] 8.3 Create `tests/property/command-database-cache.prop.test.ts`
    - Property tests for cache operations
    - _Requirements: 4.3, 4.4_
  - [x] 8.4 Create `tests/property/abbreviation-minimum-uniqueness.prop.test.ts`
    - Property tests for abbreviation uniqueness guarantees
    - _Requirements: 3.1, 3.2_
  - [x] 8.5 Create `tests/property/cache-serialization-roundtrip.prop.test.ts`
    - Round-trip property tests for cache serialization
    - _Requirements: 1.4, 4.3_

## Completed Implementation

### Files Created
- `src/command-database/types.ts` - Minimal type definitions
- `src/command-database/index.ts` - Fast command database
- `src/command-database/cache-schema.ts` - Full cache schema with serialization
- `src/command-database/abbreviation-builder.ts` - Abbreviation dictionary builder
- `src/command-database/abbreviation-resolver.ts` - Runtime abbreviation resolver
- `src/command-database/version-detector.ts` - Stata version detection
- `scripts/generate-cache.ts` - Manual cache generation script
- `tests/unit/command-database.test.ts` - Fast unit tests
- `tests/integration/lsp-providers-command-db.test.ts` - LSP integration tests
- `tests/property/command-database-*.prop.test.ts` - Property-based tests
- `src/command-database/caches/v18.json` - Test cache with commands
- `src/command-database/README.md` - Documentation

### Performance Achieved
- **Tests**: Unit tests complete in <10ms
- **Cache Generation**: Files processed in parallel for maximum efficiency
- **Lookup**: Microsecond command lookups
- **Parallel Processing**: Files read concurrently using Promise.all

### Usage
```bash
# Generate cache manually
bun scripts/generate-cache.ts 18 src/command-database/caches/v18.json

# Run fast tests
bun test tests/unit/command-database.test.ts
```

## Notes

- Cache generation is manual (run when needed, commit results)
- Tests are fast and deterministic
- Minimal parsing extracts only essential metadata
- System prioritizes speed over comprehensive features
- Full integration with LSP providers (completion, hover) is complete
- Property-based tests validate correctness properties
