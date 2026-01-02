# Design Document: macOS Bash Compatibility

## Overview

This design addresses compatibility issues in `setup.sh` with macOS's default bash version (3.2). macOS ships with bash 3.2 due to GPLv3 licensing concerns, and the current script uses several bash 4+ features that may fail or behave unexpectedly on macOS.

The changes are minimal and focused: replace incompatible syntax with POSIX-compliant alternatives while maintaining the same functionality.

## Architecture

No architectural changes required. This is a syntax-level refactoring of the existing `setup.sh` script.

## Components and Interfaces

### Modified Component: setup.sh

The script maintains its existing structure and functionality. Only specific syntax patterns are replaced:

| Current Syntax | Replacement | Reason |
|----------------|-------------|--------|
| `< <(command)` | Pipe with `while read` | Process substitution unreliable in bash 3.2 |
| `((INSTALLED++))` | `INSTALLED=$((INSTALLED + 1))` | Arithmetic increment syntax |
| `read -p` without `-r` | `read -r -p` | Prevent backslash mangling |
| `ls -t \| head -1` | `find ... -print0 \| sort -z` | Handle special filenames |

### Extension Detection Refactoring

The `detect_incompatible_extensions` function currently returns an array via printf. The calling code uses process substitution to iterate:

```bash
# Current (problematic)
while IFS= read -r extension; do
    ...
done < <(detect_incompatible_extensions "$editor")
```

Refactored approach using a pipe:

```bash
# Refactored (POSIX-compliant)
detect_incompatible_extensions "$editor" | while IFS= read -r extension; do
    ...
done
```

**Important**: Variables modified inside a piped `while` loop run in a subshell and won't persist. The `skip_installation` variable must be handled differently - we'll use a different control flow approach.

### Alternative: Inline Extension Check

Since we only check for one extension currently, we can simplify by inlining the check:

```bash
# Simplified inline approach
if "$editor" --list-extensions 2>/dev/null | grep -q "kylebarron.stata-enhanced"; then
    # Handle conflict for this specific extension
fi
```

This avoids the subshell variable scope issue entirely.

## Data Models

No data model changes. The script uses simple string variables and arrays.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: No Bash 4+ Specific Syntax

*For any* line in the setup.sh script, the line SHALL NOT contain bash 4+ specific syntax patterns including:
- Process substitution: `< <(`
- Mapfile/readarray: `mapfile` or `readarray`
- C-style arithmetic increment: `((` followed by `++` or `--`

**Validates: Requirements 1.1, 1.2, 2.1, 2.2, 3.2**

### Property 2: Read Commands Use -r Flag

*For any* `read` command in the setup.sh script, the command SHALL include the `-r` flag to prevent backslash interpretation.

**Validates: Requirements 4.1**

### Property 3: VSIX Discovery Uses Find

*For any* VSIX file discovery operation in the setup.sh script, the script SHALL use `find` command instead of `ls` for robustness with special filenames.

**Validates: Requirements 5.1**

## Error Handling

No changes to error handling. The script already uses `set -e` for fail-fast behavior.

## Testing Strategy

### Unit Tests (Shell Script Validation)

Since this is a shell script, testing focuses on static analysis:

1. **Syntax validation**: Run `bash -n setup.sh` to check for syntax errors
2. **ShellCheck**: Run `shellcheck setup.sh` to detect common issues
3. **Pattern verification**: Grep for prohibited patterns

### Property-Based Tests

Property tests will verify the script doesn't contain incompatible syntax by scanning the file content:

- Use fast-check to generate test scenarios
- Parse setup.sh and verify absence of prohibited patterns
- Each property test runs minimum 100 iterations

### Manual Testing

1. Test on macOS with default bash (`/bin/bash --version` shows 3.2.x)
2. Test on Linux with bash 5.x to ensure no regressions
3. Verify all installation paths work correctly
