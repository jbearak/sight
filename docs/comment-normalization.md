# Comment Style Normalization Guide

This guide explains how to use the comment style normalization feature in Sight.

## Overview

Comment style normalization allows you to automatically convert comments to your preferred style during formatting operations. This helps maintain a consistent coding style across your Stata projects.

## Quick Start

1. Open your VS Code settings (`⌘,` on macOS, `Ctrl+,` on Windows/Linux)
2. Search for "sight"
3. Enable `sight.formatting.normalizeCommentStyle`
4. Choose your preferred comment style from `sight.formatting.preferredCommentStyle`
5. Format your document (`⇧⌥F` on macOS, `Shift+Alt+F` on Windows/Linux)

## Supported Comment Styles

### Slash Comments (`//`)

Single-line comments using the slash style:

```stata
// This is a slash comment
generate x = 1  // inline comment
```

**Pros:**
- Modern, widely recognized syntax
- Clear visual distinction from code
- Commonly used in other programming languages

**Cons:**
- Not traditional Stata style
- May look unfamiliar to long-time Stata users

### Star Comments (`*`)

Single-line comments using the traditional Stata star style:

```stata
* This is a star comment
generate x = 1  * inline comment
```

**Pros:**
- Traditional Stata style
- Familiar to experienced Stata users
- Compact syntax

**Cons:**
- Can be confused with multiplication operator
- Less common in other programming languages

### Block Comments (`/* */`)

Multi-line comments using block syntax:

```stata
/* This is a block comment
   spanning multiple lines */
generate x = 1  /* inline block comment */
```

**Pros:**
- Ideal for multi-line comments
- Clear visual boundaries
- Supports nested structures

**Cons:**
- More verbose for single-line comments
- Requires closing delimiter

## Configuration

### Basic Configuration

Add these settings to your VS Code `settings.json`:

```json
{
  "sight.formatting.normalizeCommentStyle": true,
  "sight.formatting.preferredCommentStyle": "line",
  "sight.formatting.commentLineWidth": 72
}
```

### Configuration Options

#### `normalizeCommentStyle` (boolean)

- **Default:** `false`
- **Description:** Enable or disable comment style normalization
- **When disabled:** All comment styles are preserved as-is
- **When enabled:** Comments are converted to the preferred style during formatting

#### `preferredCommentStyle` (string)

- **Default:** `"line"`
- **Options:** `"line"`, `"//"`, `"*"`, `"/* */"`
- **Description:** Your preferred comment style. `"line"` uses the same style as `sight.lineCommentStyle`.
- **Effect:** All comments will be converted to this style when normalization is enabled

#### `normalizeOnSave` (boolean)

- **Default:** `false`
- **Description:** Automatically normalize comments when saving files
- **Requirements:** Requires `normalizeCommentStyle` to be enabled
- **Note:** Works in conjunction with VS Code's `editor.formatOnSave` setting

#### `commentLineWidth` (number)

- **Default:** `72`
- **Range:** 40-120 (recommended)
- **Description:** Maximum line width for comment wrapping
- **Effect:** Comments longer than this width will be wrapped at word boundaries

## Usage Examples

### Example 1: Converting to Slash Comments

**Before:**
```stata
* Load the dataset
use mydata.dta

/* Perform analysis
   This is a multi-line comment */
regress y x1 x2

* Calculate predictions
predict yhat
```

**Configuration:**
```json
{
  "sight.formatting.normalizeCommentStyle": true,
  "sight.formatting.preferredCommentStyle": "//"
}
```

**After (Format Document):**
```stata
// Load the dataset
use mydata.dta

// Perform analysis
// This is a multi-line comment
regress y x1 x2

// Calculate predictions
predict yhat
```

### Example 2: Converting to Star Comments

**Before:**
```stata
// Load the dataset
use mydata.dta

// Perform analysis
regress y x1 x2

// Calculate predictions
predict yhat
```

**Configuration:**
```json
{
  "sight.formatting.normalizeCommentStyle": true,
  "sight.formatting.preferredCommentStyle": "*"
}
```

**After (Format Document):**
```stata
* Load the dataset
use mydata.dta

* Perform analysis
regress y x1 x2

* Calculate predictions
predict yhat
```

### Example 3: Comment Line Wrapping

**Before:**
```stata
* This is a very long comment that exceeds the configured line width and should be wrapped at word boundaries to maintain readability
generate x = 1
```

**Configuration:**
```json
{
  "sight.formatting.normalizeCommentStyle": true,
  "sight.formatting.preferredCommentStyle": "//",
  "sight.formatting.commentLineWidth": 50
}
```

**After (Format Document):**
```stata
// This is a very long comment that exceeds
// the configured line width and should be
// wrapped at word boundaries to maintain
// readability
generate x = 1
```

## Special Cases

### Continuation Comments

Continuation comments (`///`) are **never normalized**. They have special meaning in Stata for line continuation and must be preserved:

```stata
generate long_variable_name = ///
    some_expression + ///
    another_expression
```

These will remain unchanged regardless of your normalization settings.

### Embedded Language Blocks

Comments within Mata or Python blocks are **preserved in their original style**:

```stata
mata:
    // This comment stays as-is
    real matrix my_function() {
        // Even if you prefer * style
        return (1, 2, 3)
    }
end

python:
    # Python comments are never modified
    def my_function():
        return [1, 2, 3]
end
```

### Markdown in Comments

The formatter respects Markdown syntax in comments:

```stata
// # Main Section
// - List item 1
// - List item 2
// 
// ```stata
// code block
// ```
```

Markdown elements like list items and code blocks are preserved during line wrapping.

## Workflow Integration

### Format on Save

To automatically normalize comments when saving:

1. Enable `sight.formatting.normalizeOnSave`
2. Enable `editor.formatOnSave` in VS Code
3. Comments will be normalized every time you save

**Configuration:**
```json
{
  "editor.formatOnSave": true,
  "sight.formatting.normalizeCommentStyle": true,
  "sight.formatting.normalizeOnSave": true,
  "sight.formatting.preferredCommentStyle": "//"
}
```

### Manual Formatting

To format on demand:

1. Open a Stata file
2. Press `⇧⌥F` on macOS (`Shift+Alt+F` on Windows/Linux)
3. Or use Command Palette: `⌘⇧P` on macOS (`Ctrl+Shift+P` on Windows/Linux) → Format Document

### Range Formatting

To format only a specific range:

1. Select the code you want to format
2. Press `⌘K ⌘F` on macOS (`Ctrl+K Ctrl+F` on Windows/Linux)
3. Or use Command Palette: `⌘⇧P` on macOS (`Ctrl+Shift+P` on Windows/Linux) → Format Selection

## Best Practices

### 1. Commit Your Work Before Trying It

Make sure your working tree is clean (or stash your changes) before enabling normalization. Then run the formatter, inspect the diff with `git diff`, and either commit the result or `git restore` to back out:

```bash
git status            # confirm a clean tree
# enable normalizeCommentStyle, then format
git diff              # review the rewrite
git commit -am "Normalize comment style"   # or: git restore .
```

### 2. Choose a Consistent Style

Pick one preferred style and stick with it across your team:

- **Recommendation for new projects:** Use `//` (modern, widely recognized)
- **Recommendation for existing projects:** Match your team's existing style

### 3. Document Your Choice

Include your comment style preference in your project's coding standards:

```markdown
## Code Style

- Comment style: `//` (slash comments)
- Line width: 72 characters
- Indentation: 4 spaces
```

### 4. Use Format-on-Save Carefully

Enable `normalizeOnSave` only if:
- Your entire team uses the same settings
- You want automatic normalization on every save
- You're comfortable with automatic changes

## Troubleshooting

### Comments Not Being Normalized

**Problem:** Comments aren't changing when I format.

**Solution:**
1. Check that `normalizeCommentStyle` is set to `true`
2. Verify `preferredCommentStyle` is set to your desired style
3. Make sure you're using Format Document (`⇧⌥F` on macOS, `Shift+Alt+F` on Windows/Linux)
4. Check the Output panel for any error messages

### Unexpected Formatting

**Problem:** Comments are being formatted in unexpected ways.

**Solution:**
1. Check your `commentLineWidth` setting
2. Verify that Markdown elements are being preserved correctly
3. Check for continuation comments (`///`) which are never normalized
4. Review embedded language blocks (Mata/Python) which preserve original style

### Performance Issues

**Problem:** Formatting is slow on large files.

**Solution:**
1. Increase `commentLineWidth` to reduce wrapping
2. Disable `normalizeOnSave` if it's causing delays
3. Use range formatting instead of full document formatting
4. Check for very large files (>10,000 lines)

## Advanced Configuration

### Team Settings

For team projects, create a `.vscode/settings.json` file:

```json
{
  "sight.formatting.normalizeCommentStyle": true,
  "sight.formatting.preferredCommentStyle": "//",
  "sight.formatting.commentLineWidth": 72,
  "editor.formatOnSave": true
}
```

This ensures all team members use the same settings.

### Per-Project Configuration

Different projects can have different comment styles:

**Project A (.vscode/settings.json):**
```json
{
  "sight.formatting.preferredCommentStyle": "//"
}
```

**Project B (.vscode/settings.json):**
```json
{
  "sight.formatting.preferredCommentStyle": "*"
}
```

## Notes

- Only comment delimiters are changed; comment content is preserved exactly.
- Comments inside strings are never modified — only actual comments are normalized.
- Comments in Mata and Python blocks are preserved in their original style (see [Embedded Language Blocks](#embedded-language-blocks)).
- Normalization converts every comment in scope to the preferred style. To keep mixed styles in a file, leave `normalizeCommentStyle` off (the default) or use [Range Formatting](#range-formatting) to normalize only a selection.
- Formatting changes can be undone with `⌘Z` on macOS (`Ctrl+Z` on Windows/Linux).
