# Requirements Document

## Introduction

This feature implements a disk-based symbol cache for the Stata LSP, persisting extracted symbols with file modification timestamps and content hashes. This allows unchanged files to skip lexing, parsing, and analysis on LSP startup, significantly reducing initialization time for large workspaces.

## Glossary

- **Symbol_Cache**: The persistent storage for extracted symbols and metadata
- **Cache_Entry**: A record containing symbols, file hash, and modification time for a single file
- **Content_Hash**: A hash of file contents used to detect changes even when mtime is unreliable
- **Cache_Invalidation**: The process of detecting and removing stale cache entries
- **Warm_Start**: LSP initialization that loads symbols from cache rather than re-parsing

## Requirements

### Requirement 1: Cache Storage Format

**User Story:** As a developer, I want the LSP to persist symbol information to disk, so that startup is fast even for large workspaces.

#### Acceptance Criteria

1. THE Symbol_Cache SHALL store extracted symbols in a structured format (JSON or binary)
2. EACH Cache_Entry SHALL include: file path, mtime, Content_Hash, and extracted symbols
3. THE Symbol_Cache SHALL store cache files in a workspace-specific location (.stata-lsp/cache or similar)
4. THE Symbol_Cache SHALL use a versioned format to handle cache format upgrades

### Requirement 2: Cache Validation

**User Story:** As a developer, I want the LSP to detect when cached symbols are stale, so that I always see accurate symbol information.

#### Acceptance Criteria

1. WHEN loading a Cache_Entry, THE Symbol_Cache SHALL compare file mtime with cached mtime
2. WHEN mtime matches, THE Symbol_Cache SHALL verify Content_Hash for additional safety
3. WHEN mtime or hash differs, THE Symbol_Cache SHALL invalidate the entry and trigger re-parsing
4. WHEN a file is deleted, THE Symbol_Cache SHALL remove its Cache_Entry

### Requirement 3: Warm Start Behavior

**User Story:** As a developer opening a workspace, I want the LSP to load cached symbols immediately, so that features like go-to-definition work without waiting for full indexing.

#### Acceptance Criteria

1. WHEN the LSP starts, THE Symbol_Cache SHALL load valid cache entries before workspace scanning
2. WHEN cache entries are loaded, THE Indexer SHALL skip parsing for files with valid cache
3. WHEN some cache entries are invalid, THE Indexer SHALL re-parse only those files
4. THE Symbol_Cache SHALL support background validation while serving cached results

### Requirement 4: Cache Updates

**User Story:** As a developer editing files, I want the cache to stay current, so that restarts remain fast.

#### Acceptance Criteria

1. WHEN a file is parsed (due to edit or cache miss), THE Symbol_Cache SHALL update its Cache_Entry
2. THE Symbol_Cache SHALL write updates asynchronously to avoid blocking LSP operations
3. WHEN the LSP shuts down gracefully, THE Symbol_Cache SHALL flush pending updates
4. THE Symbol_Cache SHALL handle concurrent access safely (multiple LSP instances)

### Requirement 5: Cache Management

**User Story:** As a developer, I want to manage the symbol cache, so that I can clear it if needed or understand its status.

#### Acceptance Criteria

1. THE Symbol_Cache SHALL provide a command to clear the cache for the current workspace
2. THE Symbol_Cache SHALL provide a command to report cache statistics (hit rate, size, entries)
3. THE Symbol_Cache SHALL automatically prune entries for files that no longer exist
4. THE Symbol_Cache SHALL limit total cache size and evict oldest entries when exceeded
