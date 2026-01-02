# Requirements Document

## Introduction

The `setup.sh` script needs to be compatible with macOS's default bash version (3.2), which lacks many features available in bash 4+. macOS ships with an older bash due to licensing (GPLv3) concerns, and many users rely on the system default. The script currently uses bash features that may not work correctly on macOS.

## Glossary

- **Setup_Script**: The `setup.sh` shell script that builds and installs the Sight LSP extension
- **Bash_3.2**: The default bash version shipped with macOS (released 2007, lacks bash 4+ features)
- **Process_Substitution**: A bash feature using `< <(command)` syntax to feed command output as a file
- **POSIX_Compliant**: Shell syntax that works across all POSIX-compliant shells

## Requirements

### Requirement 1: Process Substitution Replacement

**User Story:** As a macOS user, I want the setup script to work with the default bash, so that I don't need to install a newer bash version.

#### Acceptance Criteria

1. WHEN the Setup_Script detects incompatible extensions, THE Setup_Script SHALL use a POSIX-compliant loop construct instead of process substitution
2. WHEN iterating over detected extensions, THE Setup_Script SHALL avoid `< <(command)` syntax that may fail in Bash_3.2
3. THE Setup_Script SHALL use temporary files or pipes as alternatives to process substitution

### Requirement 2: Arithmetic Expression Compatibility

**User Story:** As a macOS user, I want arithmetic operations to work correctly, so that the script counts installed editors properly.

#### Acceptance Criteria

1. WHEN incrementing counters, THE Setup_Script SHALL use POSIX-compliant arithmetic syntax
2. THE Setup_Script SHALL replace `((INSTALLED++))` with `INSTALLED=$((INSTALLED + 1))` or equivalent
3. WHEN performing arithmetic comparisons, THE Setup_Script SHALL use `[ ]` or `[[ ]]` with proper syntax

### Requirement 3: Array Handling Compatibility

**User Story:** As a macOS user, I want array operations to work correctly, so that extension detection functions properly.

#### Acceptance Criteria

1. WHEN returning multiple values from functions, THE Setup_Script SHALL use POSIX-compliant approaches
2. THE Setup_Script SHALL avoid relying on array features that behave differently in Bash_3.2
3. WHEN detecting incompatible extensions, THE Setup_Script SHALL use simple string or line-based output

### Requirement 4: Read Command Best Practices

**User Story:** As a user, I want the script to handle input correctly, so that special characters in responses don't cause issues.

#### Acceptance Criteria

1. WHEN reading user input, THE Setup_Script SHALL use `read -r` to prevent backslash mangling
2. THE Setup_Script SHALL handle edge cases in user input gracefully

### Requirement 5: File Listing Best Practices

**User Story:** As a user, I want the script to find VSIX files reliably, so that installation works with any filename.

#### Acceptance Criteria

1. WHEN finding VSIX files, THE Setup_Script SHALL use `find` instead of `ls` for robustness
2. THE Setup_Script SHALL handle filenames with spaces or special characters correctly
