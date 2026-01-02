---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Requirements superseded by smcl-syntax-cleanup due to incompatible changes
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - stata-lsp: [Core dependency]
Status: Superseded
Superseded By: smcl-syntax-cleanup
Related Specs:
  - forward-scope-resolution: [Related cross-file spec]
  - cross-file-awareness: [Related cross-file spec]
  - working-directory-inheritance: [Related cross-file spec]
---

# Requirements Document

**⚠️ REQUIREMENTS SUPERSEDED**

The requirements in this specification have been superseded by incompatible changes implemented in smcl-syntax-cleanup. The approach evolved from extracting comprehensive metadata including basic syntax and descriptions from SMCL files to minimal extraction only, specifically removing syntax extraction and documentation parsing.

**Original requirements below are preserved for historical reference only.**

## Introduction

This feature implements a minimal, fast command metadata system for the Stata LSP that provides command recognition and abbreviation support. The system uses manual cache generation from SMCL help files, prioritizing speed and simplicity over comprehensive parsing. Cache generation is performed manually when needed and results are committed to the repository.

## Glossary

- **Command_Metadata_System**: Minimal system that stores and retrieves basic command information
- **Cache_Generator**: Manual script that processes SMCL files and produces JSON metadata files
- **Command_Database**: In-memory store of command metadata loaded from cache files
- **Abbreviation_Resolver**: Component that expands command abbreviations to full names

## Requirements

### Requirement 1: Manual Cache Generation

**User Story:** As an LSP developer, I want to manually generate command caches when needed, so that I can control when processing occurs and commit stable cache files to the repository.

#### Acceptance Criteria

1. WHEN the Cache_Generator script runs THEN it SHALL search standard Stata installation paths for `.sthlp` files
2. WHEN processing SMCL files THEN the Cache_Generator SHALL extract minimal metadata: command name, basic syntax, description, and abbreviation length
3. WHEN processing SMCL files THEN the Cache_Generator SHALL read files in parallel for maximum efficiency
4. WHEN generating a cache THEN the Cache_Generator SHALL produce a JSON file with commands and abbreviations
5. WHEN the script completes THEN the cache file SHALL be ready for commit to the repository
6. THE Cache_Generator SHALL process files quickly (seconds, not hours)

### Requirement 2: Command Database Loading and Lookup

**User Story:** As an LSP component, I want to query command metadata efficiently, so that I can provide fast completions.

#### Acceptance Criteria

1. WHEN the LSP starts THEN the Command_Database SHALL load cache from bundled JSON file
2. WHEN looking up a command THEN the Command_Database SHALL return basic metadata
3. WHEN looking up an abbreviated command THEN the Command_Database SHALL resolve abbreviation then return metadata
4. WHEN a command is not found THEN the Command_Database SHALL return null without error
5. ALL lookups SHALL complete in milliseconds

### Requirement 3: Command Abbreviation Resolution

**User Story:** As a Stata developer, I want the LSP to recognize command abbreviations, so that I can use shorthand like `g` for `generate`.

#### Acceptance Criteria

1. WHEN building the abbreviation dictionary THEN the Abbreviation_Resolver SHALL map valid abbreviations to full command names
2. WHEN a user types a partial command THEN the Abbreviation_Resolver SHALL expand it to the canonical command name
3. FOR ALL valid abbreviations, resolving then looking up SHALL return the same metadata as looking up the full command name

### Requirement 4: Fast Testing

**User Story:** As an LSP developer, I want tests that run quickly, so that I can iterate rapidly during development.

#### Acceptance Criteria

1. WHEN running unit tests THEN they SHALL complete in under 10ms
2. WHEN testing command lookup THEN tests SHALL use minimal test data
3. WHEN testing abbreviation resolution THEN tests SHALL verify round-trip behavior
4. ALL tests SHALL be deterministic and not depend on external files
