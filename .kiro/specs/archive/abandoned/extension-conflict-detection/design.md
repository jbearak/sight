# Design Document: Extension Conflict Detection

## Overview

This feature adds extension conflict detection to the Sight VS Code client extension. The implementation follows a modular approach with a dedicated `ConflictDetector` class that handles all conflict-related logic, keeping the main extension activation clean and focused.

The design prioritizes:
- **Non-intrusive UX**: One-time warnings that don't repeatedly bother users
- **Contextual awareness**: Status bar indicator only when working on Stata files
- **Testability**: Pure functions for conflict detection logic

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     extension.ts                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              activate(context)                       │    │
│  │  - Initialize ConflictDetector                       │    │
│  │  - Call checkAndNotify()                            │    │
│  │  - Register onDidChangeActiveTextEditor listener    │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  conflict-detector.ts                        │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              ConflictDetector                        │    │
│  │  - detectConflicts(): ConflictingExtension[]        │    │
│  │  - checkAndNotify(): void                           │    │
│  │  - showConflictWarning(): void                      │    │
│  │  - updateStatusBar(): void                          │    │
│  │  - isStataFileActive(): boolean                     │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  Listens to: onDidChangeActiveTextEditor                    │
│  Shows status bar only when: conflicts && Stata file active │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              conflict-detector-core.ts                       │
│  ┌─────────────────────────────────────────────────────┐    │
│  │         Pure functions (testable)                    │    │
│  │  - isConflictingExtension(ext, ownId): boolean      │    │
│  │  - findConflictingExtensions(exts, ownId): []       │    │
│  │  - formatConflictMessage(conflicts): string         │    │
│  │  - isStataFile(fileName): boolean                   │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### ConflictingExtension Interface

```typescript
interface ConflictingExtension {
    id: string;           // e.g., "publisher.extension-name"
    displayName: string;  // Human-readable name from package.json
}
```

### ConflictDetector Class

The main class that orchestrates conflict detection and user notifications.

```typescript
class ConflictDetector {
    private context: vscode.ExtensionContext;
    private statusBarItem: vscode.StatusBarItem | undefined;
    private outputChannel: vscode.OutputChannel;
    private conflicts: ConflictingExtension[];  // Cached conflict list
    
    constructor(
        context: vscode.ExtensionContext,
        outputChannel: vscode.OutputChannel
    );
    
    // Detect all conflicting extensions
    detectConflicts(): ConflictingExtension[];
    
    // Main entry point: detect, notify if needed, update status bar
    checkAndNotify(): void;
    
    // Show warning notification with action buttons
    showConflictWarning(conflicts: ConflictingExtension[]): void;
    
    // Update status bar visibility based on conflicts and active editor
    updateStatusBar(): void;
    
    // Check if active editor has a Stata file
    isStataFileActive(): boolean;
    
    // Show conflict help (triggered by status bar click)
    showConflictHelp(): void;
    
    // Dispose resources
    dispose(): void;
}
```

### Pure Detection Functions (conflict-detector-core.ts)

```typescript
// File extensions that indicate Stata language support
const STATA_FILE_EXTENSIONS = ['.do', '.ado', '.mata'];

// Check if a single extension conflicts with Sight
function isConflictingExtension(
    extension: vscode.Extension<unknown>,
    ownExtensionId: string
): boolean;

// Find all conflicting extensions from the full list
function findConflictingExtensions(
    extensions: readonly vscode.Extension<unknown>[],
    ownExtensionId: string
): ConflictingExtension[];

// Format conflict list into user-friendly message
function formatConflictMessage(conflicts: ConflictingExtension[]): string;

// Format conflicts for tooltip (multiline)
function formatConflictTooltip(conflicts: ConflictingExtension[]): string;

// Check if a file name has a Stata extension
function isStataFile(fileName: string | undefined): boolean;
```

## Data Models

### Global State Keys

```typescript
const GLOBAL_STATE_KEYS = {
    CONFLICT_WARNING_SHOWN: 'sight.conflictWarningShown'
} as const;
```

### Extension Package JSON Structure (for type safety)

```typescript
interface ExtensionLanguageContribution {
    id?: string;
    extensions?: string[];
}

interface ExtensionContributes {
    languages?: ExtensionLanguageContribution[];
}

interface ExtensionPackageJSON {
    displayName?: string;
    contributes?: ExtensionContributes;
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Conflict Detection Correctness

*For any* extension metadata object, the extension is identified as conflicting if and only if:
- It contributes the 'stata' language ID, OR
- It registers any of the file extensions `.do`, `.ado`, or `.mata`
AND it is not the Sight extension itself (by extension ID).

**Validates: Requirements 1.2, 1.3, 1.4**

### Property 2: Self-Exclusion Invariant

*For any* list of extensions that includes the Sight extension, the Sight extension SHALL never appear in the returned conflict list, even if it matches all conflict criteria.

**Validates: Requirements 1.4**

### Property 3: Output Structure Completeness

*For any* extension identified as conflicting, the returned `ConflictingExtension` object SHALL contain a non-empty `id` string and a `displayName` string (which may fall back to the id if displayName is not set in package.json).

**Validates: Requirements 1.5**

### Property 4: Message Formatting Completeness

*For any* non-empty list of conflicting extensions, the formatted warning message SHALL contain the display name of every extension in the list.

**Validates: Requirements 2.2, 3.2**

### Property 5: Warning Suppression After Dismissal

*For any* state where the conflict warning has been previously shown (globalState contains `conflictWarningShown: true`), the `shouldShowWarning()` function SHALL return `false`.

**Validates: Requirements 2.7**

### Property 6: Status Bar Visibility Decision

*For any* conflict state and active editor state:
- IF conflicts list is empty, the status bar item SHALL be hidden
- IF conflicts exist AND active editor has a Stata file (`.do`, `.ado`, `.mata`), the status bar item SHALL be shown
- IF conflicts exist AND active editor does NOT have a Stata file, the status bar item SHALL be hidden

**Validates: Requirements 3.1, 3.4, 3.5, 3.7, 3.8**



## Error Handling

### Extension Metadata Access

Extensions may have malformed or missing `package.json` data:

```typescript
function isConflictingExtension(ext: vscode.Extension<unknown>, ownId: string): boolean {
    // Safely access nested properties
    const packageJSON = ext.packageJSON;
    if (!packageJSON?.contributes?.languages) {
        return false;
    }
    // ... detection logic
}
```

### Global State Operations

Global state operations should handle potential failures gracefully:

```typescript
async function markWarningShown(context: vscode.ExtensionContext): Promise<void> {
    try {
        await context.globalState.update(GLOBAL_STATE_KEYS.CONFLICT_WARNING_SHOWN, true);
    } catch (error) {
        outputChannel.appendLine(`Failed to update global state: ${error}`);
        // Continue execution - warning will show again next time, which is acceptable
    }
}
```

### Missing Display Names

Some extensions may not have a `displayName` in their package.json:

```typescript
function getDisplayName(ext: vscode.Extension<unknown>): string {
    return ext.packageJSON?.displayName || ext.id;
}
```

## Testing Strategy

### Unit Tests

Unit tests verify specific examples and edge cases:

1. **Extension with 'stata' language ID** → detected as conflict
2. **Extension with '.do' file extension** → detected as conflict
3. **Extension with unrelated language** → not detected
4. **Sight extension itself** → never detected (self-exclusion)
5. **Extension with missing contributes** → not detected (graceful handling)
6. **Empty extension list** → empty conflict list
7. **Message formatting with single conflict** → correct format
8. **Message formatting with multiple conflicts** → all names included

### Property-Based Tests

Property tests use fast-check to verify universal properties across many generated inputs:

1. **Property 1 & 2**: Generate random extension metadata objects with various combinations of language IDs and file extensions. Verify detection logic is correct and self-exclusion holds.

2. **Property 3**: For any generated conflicting extension, verify output structure contains required fields.

3. **Property 4**: Generate random lists of conflicting extensions. Verify formatted message contains all display names.

4. **Property 5**: Generate random boolean states for `conflictWarningShown`. Verify `shouldShowWarning` returns correct value.

5. **Property 6**: Generate random conflict lists (including empty). Verify status bar visibility decision is correct.

### Test Configuration

- Property tests: minimum 100 iterations per property
- Test framework: Bun test with fast-check
- Tag format: **Feature: extension-conflict-detection, Property N: [property description]**

### Test File Structure

```
tests/
  unit/
    conflict-detector-core.test.ts    # Pure function tests
  property/
    conflict-detector.property.test.ts # Property-based tests
```

## Implementation Notes

### VS Code API Usage

```typescript
// Get all installed extensions
const allExtensions = vscode.extensions.all;

// Show warning with action buttons
const selection = await vscode.window.showWarningMessage(
    message,
    'Disable Other Extension(s)',
    'Uninstall Other Extension(s)',
    'Learn More',
    'Dismiss'
);

// Open extensions view
await vscode.commands.executeCommand('workbench.extensions.action.showInstalledExtensions');

// Open external URL
await vscode.env.openExternal(vscode.Uri.parse(DOCS_URL));

// Create status bar item
const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100  // priority
);

// Listen for active editor changes (to show/hide status bar)
vscode.window.onDidChangeActiveTextEditor((editor) => {
    conflictDetector.updateStatusBar();
});

// Get active editor file name
const fileName = vscode.window.activeTextEditor?.document.fileName;
```

### Constants

```typescript
const SIGHT_EXTENSION_ID = 'jbearak.sight-client';
const DOCS_URL = 'https://github.com/jbearak/sight?tab=readme-ov-file#installation';
const STATA_FILE_EXTENSIONS = ['.do', '.ado', '.mata'];
const STATA_LANGUAGE_ID = 'stata';
```

### Command Registration

No additional commands are required for this feature. The status bar item provides access to conflict help when clicked.
