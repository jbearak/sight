---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - stata-lsp: [Core dependency]
  - command-metadata-system: [Core dependency]
Status: Active
Related Specs:
  - option-extraction: [Related completion spec]
  - syntax-command-simplification: [Related completion spec]
  - embedded-language-detection: [Related completion spec]
---

# Requirements Document

## Introduction

This document specifies requirements for cleaning up the command database system in the Stata LSP. During development, two parallel type systems emerged: a minimal system that is actually used at runtime, and an elaborate system with version-tracking features that was never fully implemented. This cleanup removes dead code and consolidates to a single, minimal type system.

## Glossary

- **Minimal_Types**: The simple types in `types.ts` with `CommandInfo` containing only `name`, `syntax`, `description`, `min_abbreviation`
- **Elaborate_Schema**: The complex types in `cache-schema.ts` with `CommandMetadata` containing `introduced_version`, `deprecated_version`, `help_smcl`, `stored_results`, etc.
- **Active_Generator**: The `scripts/generate-cache.ts` script that produces the v18.json cache currently in use
- **Dead_Generator**: The `scripts/generate-command-cache.ts` script that uses the elaborate schema but is never run
- **Dead_Code**: Code that is never executed at runtime or during cache generation

## Requirements

### Requirement 1: Remove Elaborate Schema

**User Story:** As a developer, I want to remove unused type definitions, so that the codebase is easier to understand and maintain.

#### Acceptance Criteria

1. THE System SHALL delete `src/command-database/cache-schema.ts`
2. THE System SHALL remove all imports of types from `cache-schema.ts`
3. THE System SHALL update any code that references `CommandMetadata` to use `CommandInfo` from `types.ts`
4. WHEN the cleanup is complete, THE Codebase SHALL compile without TypeScript errors

### Requirement 2: Remove Dead Generator Script

**User Story:** As a developer, I want to remove duplicate scripts, so that there is one clear way to generate caches.

#### Acceptance Criteria

1. THE System SHALL delete `scripts/generate-command-cache.ts`
2. THE System SHALL retain `scripts/generate-cache.ts` as the sole cache generator
3. WHEN a developer needs to regenerate the cache, THE Documentation SHALL point to `generate-cache.ts`

### Requirement 3: Consolidate Abbreviation Handling

**User Story:** As a developer, I want abbreviation logic to use the minimal types, so that there is no dependency on the elaborate schema.

#### Acceptance Criteria

1. THE `abbreviation-builder.ts` SHALL be updated to use `CommandInfo` from `types.ts` instead of `CommandMetadata`
2. THE `abbreviation-resolver.ts` SHALL be updated to use simple `Record<string, string>` for abbreviations instead of `AbbreviationDict`
3. IF the abbreviation modules are not used by the runtime, THEN THE System SHALL delete them
4. THE System SHALL verify that abbreviation expansion still works correctly after changes

### Requirement 4: Remove Misleading Version API

**User Story:** As a developer, I want the API to accurately reflect its capabilities, so that I don't rely on non-functional features.

#### Acceptance Criteria

1. THE `is_available_in_version()` method SHALL be removed from `CommandDatabase` class
2. IF `version-detector.ts` is not used by any runtime code, THEN THE System SHALL delete it
3. THE System SHALL remove any exports of version-related types that are no longer needed
4. WHEN a developer reads the API, THE Methods SHALL accurately describe their functionality

### Requirement 5: Update Tests

**User Story:** As a developer, I want tests to use the correct types, so that they validate actual runtime behavior.

#### Acceptance Criteria

1. THE Property tests SHALL be updated to use `CommandInfo` instead of `CommandMetadata`
2. THE Unit tests SHALL be updated to remove references to `cache-schema.ts`
3. WHEN tests reference version-tracking fields like `introduced_version`, THE Tests SHALL be updated or removed
4. THE Test suite SHALL pass after all changes

### Requirement 6: Preserve Runtime Functionality

**User Story:** As a user, I want the LSP to continue working correctly, so that my development experience is not disrupted.

#### Acceptance Criteria

1. THE Command lookup functionality SHALL continue to work after cleanup
2. THE Abbreviation expansion SHALL continue to work after cleanup
3. THE Completion provider SHALL continue to provide command completions
4. THE Hover provider SHALL continue to provide command information
5. WHEN the LSP starts, THE Server SHALL load the v18 cache successfully

