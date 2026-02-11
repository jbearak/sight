# Formatting (Experimental)

> **Warning:** The following features (Pretty Printer and Comment Formatter) exist in the codebase but are not recommended for production use at this time.

## Configuration

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `sight.formatting.indentSize` | number | `4` | Number of spaces or tab stops for indentation (minimum: 1) |
| `sight.formatting.indentStyle` | enum | `"spaces"` | Use spaces or tabs for indentation. Options: `"spaces"`, `"tabs"` |
| `sight.formatting.lineWidth` | number | `80` | Maximum line width for formatting (minimum: 40) |
| `sight.formatting.preserveAlignment` | boolean | `true` | Preserve intentional alignment in continuation lines |
| `sight.formatting.normalizeCommentStyle` | boolean | `false` | Normalize comment styles during formatting |
| `sight.formatting.preferredCommentStyle` | enum | `"line"` | Preferred comment style for normalization. `"line"` uses the value of `sight.lineCommentStyle`. Options: `"line"`, `"//"`, `"*"`, `"/* */"` |
| `sight.formatting.commentLineWidth` | number | `72` | Maximum line width for comments (minimum: 40) |

To automatically format on save, enable VS Code's built-in `editor.formatOnSave` setting.

### Alignment Preservation

When `preserveAlignment` is enabled (default), the formatter detects and preserves intentional alignment in continuation lines (lines after `///`). This allows you to maintain aligned operators, conditions, or expressions across multiple lines:

```stata
gen new_var = (condition1 == 1) ///
            & (condition2 == 2) ///
            | (condition3 == 3)
```

**Alignment with Indentation Correction**: When the formatter corrects incorrect block indentation, it preserves alignment by applying the same indentation delta to all continuation lines. For example, if a statement inside an `if` block is missing 4 spaces of indentation:

```stata
// Before formatting (missing indentation)
if condition {
gen result = (var1 == 1) ///
           & (var2 == 2) ///
           | (var3 == 3)
}

// After formatting (indentation corrected, alignment preserved)
if condition {
    gen result = (var1 == 1) ///
               & (var2 == 2) ///
               | (var3 == 3)
}
```

The formatter adds the same 4 spaces to both the base statement and all continuation lines, maintaining their relative alignment.

When alignment preservation is disabled, the formatter applies standard indentation rules to all continuation lines.

## Comment Style Normalization

Sight supports automatic comment style normalization during formatting operations. This feature allows you to maintain a consistent comment style across your codebase.

### Supported Comment Styles

Stata supports three comment styles:

1. **Slash comments** (`//`): Single-line comments
2. **Star comments** (`*`): Single-line comments (traditional Stata style)
3. **Block comments** (`/* */`): Multi-line comments

### Enabling Comment Normalization

To enable comment style normalization, add the following to your VS Code settings:

```json
{
  "sight.formatting.normalizeCommentStyle": true,
  "sight.formatting.preferredCommentStyle": "//",
  "sight.formatting.commentLineWidth": 72
}
```

### Special Cases

- **Continuation comments** (`///`): These are never normalized, as they have special meaning in Stata for line continuation.
- **Embedded language blocks**: Comments within Mata or Python blocks are preserved in their original style.
- **Markdown in comments**: The formatter respects Markdown syntax in comments and preserves list items and code blocks during line wrapping.
