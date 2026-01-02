# Design Document: Symbol Source File Links

## Overview

This feature enhances the hover provider to display clickable file links for symbol source locations. When users hover over symbols (macros, programs, scalars, matrices) defined in other files, the source file path will be displayed as a clickable markdown link that opens the file in VS Code.

The implementation modifies the existing hover provider (`src/providers/hover.ts`) to format source URIs as markdown links instead of plain text. For same-file symbols, the "Defined at:" line is shown instead of a clickable link to avoid redundancy. Macro expansions are displayed with double-backtick escaping to allow backticks in the expansion value.

## Architecture

The change is localized to the hover provider. No new components are needed.

```
┌─────────────────────────────────────────────────────────────┐
│                     Hover Provider                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  get_macro_hover()                                   │   │
│  │  get_program_hover()                                 │   │
│  │  get_scalar_matrix_hover()                           │   │
│  │           │                                          │   │
│  │           ▼                                          │   │
│  │  ┌─────────────────────────────────────────────┐    │   │
│  │  │  format_source_link(sourceUri, currentUri,  │    │   │
│  │  │                     workspaceRoot?)         │    │   │
│  │  │  - Returns clickable markdown link          │    │   │
│  │  │  - Uses relative path when possible         │    │   │
│  │  │  - Returns empty string if same file        │    │   │
│  │  └─────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Modified Component: HoverProvider

The `HoverProvider` class in `src/providers/hover.ts` will be modified to:

1. Add a new helper method `format_source_link()` that converts a sourceUri to a clickable markdown link
2. Update all hover methods that display source information to use this helper

#### New Method: format_source_link

```typescript
/**
 * Format a source URI as a clickable markdown link.
 *
 * @param source_uri - The file URI where the symbol is defined
 * @param current_uri - The URI of the current document
 * @param workspace_root - Optional workspace root for relative path calculation
 * @returns Markdown link string, or empty string if source is current file
 */
private format_source_link(
    source_uri: string,
    current_uri: string,
    workspace_root?: string
): string {
    // Don't show link if symbol is in current file
    if (source_uri === current_uri) {
        return '';
    }

    // Calculate display path (relative if within workspace)
    const display_path = this.get_display_path(source_uri, workspace_root);

    // Return markdown link format
    return `\n\n[${display_path}](${source_uri})`;
}
```

#### New Method: get_display_path

```typescript
/**
 * Get a user-friendly display path for a URI.
 * Returns relative path if within workspace, otherwise full path.
 *
 * @param uri - The file URI
 * @param workspace_root - Optional workspace root URI
 * @returns Display path string
 */
private get_display_path(uri: string, workspace_root?: string): string {
    // Convert file:// URI to path
    const file_path = uri.startsWith('file://')
        ? decodeURIComponent(uri.replace('file://', ''))
        : uri;

    if (workspace_root) {
        const workspace_path = workspace_root.startsWith('file://')
            ? decodeURIComponent(workspace_root.replace('file://', ''))
            : workspace_root;

        if (file_path.startsWith(workspace_path)) {
            // Return relative path
            return file_path.substring(workspace_path.length).replace(/^\//, '');
        }
    }

    // Return full path (or just filename if path is too long)
    return file_path;
}
```

### Updated Methods

The following existing methods will be updated to use `format_source_link()`:

1. `get_macro_hover()` - For local and global macros
   - Cross-file: Shows `Source: [relative_path](uri), line X` with `Expansion: ```\nvalue\n```
   - Same-file: Shows `Defined at: this file, line X` with `Expansion: ```\nvalue\n```
2. `get_program_hover()` / `get_hover_for_user_program()` - For programs
   - Cross-file: Shows `Source: [relative_path](uri)`
   - Same-file: Shows `Defined at: `uri``
3. `get_scalar_matrix_hover()` - For scalars and matrices
   - Cross-file: Shows `Source: [relative_path](uri)`
   - Same-file: Shows `Defined at: `uri``

### Interface Changes

The `HoverProvider` constructor or `get_hover()` method may need to accept an optional `workspace_root` parameter to enable relative path calculation. This can be passed from the server handlers.

## Data Models

No new data models are required. The existing `SymbolTable` types already contain `sourceUri` fields.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Cross-file symbols have clickable markdown links

*For any* symbol (macro, program, scalar, matrix) where the sourceUri differs from the current document URI, the hover output SHALL contain a valid markdown link in the format `[display_path](file://...)`.

**Validates: Requirements 1.1, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.4**

### Property 2: Same-file symbols have no source link

*For any* symbol where the sourceUri equals the current document URI, the hover output SHALL NOT contain a source link section.

**Validates: Requirements 1.3**

### Property 3: Path display is workspace-relative when applicable

*For any* sourceUri that is within the workspace root, the link display text SHALL be a relative path. *For any* sourceUri outside the workspace, the link display text SHALL be the full file path.

**Validates: Requirements 1.4, 3.2, 3.3**

## Error Handling

- If `sourceUri` is undefined or empty, no source link is displayed
- If `sourceUri` is malformed, fall back to displaying it as plain text
- If workspace root is not available, always use full paths

## Testing Strategy

### Unit Tests

Unit tests will verify:
- `format_source_link()` returns empty string when source equals current URI
- `format_source_link()` returns valid markdown link format for cross-file URIs
- `get_display_path()` returns relative paths for files within workspace
- `get_display_path()` returns full paths for files outside workspace
- Each hover method (macro, program, scalar, matrix) includes clickable links for cross-file symbols

### Property-Based Tests

Property-based tests will use fast-check to verify:
- Property 1: Generated symbols with random cross-file URIs produce valid markdown links
- Property 2: Generated symbols with same-file URIs produce no source links
- Property 3: Path relativization is correct for various workspace/file combinations

Configuration:
- Minimum 100 iterations per property test
- Use fast-check for property-based testing
- Tag format: **Feature: symbol-source-file-links, Property N: description**
