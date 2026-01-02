# Design Document: Large-File Indexing Policy

## Overview

This feature adds configurable size thresholds to the workspace indexer, allowing users to control which files are indexed during workspace scanning. Files exceeding the threshold are skipped during background indexing but are still indexed when explicitly opened in the editor.

The implementation is minimal: add a config option, check file size before indexing, track skipped files, and ensure the document store indexes opened files regardless of size.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐
│  LSP Config     │────▶│ WorkspaceIndexer │
│ (size_threshold)│     │                  │
└─────────────────┘     │ - check size     │
                        │ - skip if large  │
                        │ - track skipped  │
                        └──────────────────┘
                                 │
                                 ▼
                        ┌──────────────────┐
                        │  DocumentStore   │
                        │                  │
                        │ - index on open  │
                        │ - no size check  │
                        └──────────────────┘
```

The indexer and document store have different policies:
- **Indexer**: Skips files exceeding threshold during workspace scan
- **DocumentStore**: Always indexes opened files (user explicitly wants to work with them)

## Components and Interfaces

### Configuration Extension

Add to `StataLSPConfig` in `src/types/index.ts`:

```typescript
export interface StataLSPConfig {
  // ... existing fields ...
  indexing: {
    maxFileSizeBytes: number;  // default: 512 * 1024 (500KB)
  };
}
```

### WorkspaceIndexer Changes

Add to `src/indexer/index.ts`:

```typescript
export class WorkspaceIndexer {
  // Existing fields...
  private skipped_files: Map<string, number> = new Map(); // path -> size
  private size_threshold_bytes: number = 512 * 1024; // 500KB default

  /**
   * Configure the indexer with LSP settings.
   */
  configure(config: Partial<StataLSPConfig>): void {
    const threshold = config?.indexing?.maxFileSizeBytes;
    if (typeof threshold === 'number' && threshold > 0) {
      this.size_threshold_bytes = threshold;
    } else if (threshold !== undefined) {
      console.warn(
        `Invalid indexing.maxFileSizeBytes: ${threshold}, using default`
      );
    }
  }

  /**
   * Get list of files skipped due to size.
   */
  get_skipped_files(): Map<string, number> {
    return new Map(this.skipped_files);
  }
}
```

### index_file Changes

Modify the existing `index_file` method:

```typescript
async index_file(file_path: string): Promise<void> {
  if (this.cancelled) return;

  try {
    const stats = await fs.promises.stat(file_path);
    
    // Check against configurable threshold
    if (stats.size > this.size_threshold_bytes) {
      console.debug(
        `Skipping large file ${file_path} (${stats.size} bytes, ` +
        `threshold: ${this.size_threshold_bytes})`
      );
      this.skipped_files.set(file_path, stats.size);
      this.metrics.files_skipped++;
      return;
    }

    // ... rest of existing implementation ...
  } catch (error) {
    // ... existing error handling ...
  }
}
```

## Data Models

### IndexerMetrics Extension

The existing `IndexerMetrics` already tracks `files_skipped`. No changes needed.

### Skipped Files Tracking

```typescript
// Map from file path to file size in bytes
private skipped_files: Map<string, number> = new Map();
```

This allows reporting which specific files were skipped and why (their size).

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Config Validation

*For any* configuration value for `maxFileSizeBytes`, if it is a positive number, the indexer SHALL use that value; otherwise, the indexer SHALL use the default (500KB).

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: Skip Threshold Enforcement

*For any* file and configured threshold, the file is skipped during workspace indexing if and only if its size exceeds the threshold.

**Validates: Requirements 2.1**

### Property 3: Metrics Accuracy

*For any* set of files indexed, the `files_skipped` metric SHALL equal the count of files whose size exceeded the threshold.

**Validates: Requirements 2.3, 4.1**

### Property 4: Skipped Files List Accuracy

*For any* workspace indexing run, the skipped files list SHALL contain exactly the files that exceeded the size threshold, with their correct sizes.

**Validates: Requirements 4.2**

### Property 5: Open File Indexing

*For any* file opened in the editor via DocumentStore, the file SHALL be indexed regardless of its size.

**Validates: Requirements 3.1**

## Error Handling

| Error Condition | Handling |
|-----------------|----------|
| Invalid config value (negative, zero, non-number) | Log warning, use default 500KB |
| File stat fails | Log error, increment `files_skipped`, continue |
| Large file opened in editor | Index anyway (user intent is clear) |

## Testing Strategy

### Property-Based Tests

Use fast-check to verify the correctness properties:

1. **Config validation property**: Generate random config values (positive, negative, zero, strings, undefined) and verify the indexer uses valid values or falls back to default.

2. **Skip threshold property**: Generate random file sizes and thresholds, verify skip behavior matches `size > threshold`.

3. **Metrics accuracy property**: Generate sets of files with random sizes, verify `files_skipped` count matches actual skipped count.

4. **Skipped files list property**: Generate file sets, verify the skipped files map contains exactly the right files with correct sizes.

5. **Open file indexing property**: Generate files of various sizes, verify DocumentStore indexes all of them when opened.

### Unit Tests

- Test default threshold is 500KB
- Test threshold is read from config correctly
- Test invalid config values trigger warning and use default
- Test skipped files are logged with path and size
- Test metrics are updated correctly
