# Document Outline

The LSP provides a hierarchical document outline that shows the structure of your Stata code. The outline appears in VS Code's **Outline** panel (sidebar), **Breadcrumbs** (top of editor), and the **Go to Symbol** quick-pick (`Cmd+Shift+O` / `Ctrl+Shift+O`).

## Outline Contents

The outline displays the following symbol types:

| Symbol | Icon | Detail | Notes |
| --- | --- | --- | --- |
| Programs | Function | "Program" | Local macros nest as children |
| Global Macros | Variable | "Global Macro" | |
| Local Macros | Variable | "Local Macro" | Displayed as `` `name' `` |
| Scalars | Variable | "Scalar" | |
| Matrices | Variable | "Matrix" | |
| Variables | Field | "Variable (gen)" / "Variable (egen)" | Only `gen`/`egen` definitions |
| Mata Blocks | Module | "Mata Block" | |
| Python Blocks | Module | "Python Block" | |
| Code Sections | Module | "Section" | From structured comments |

Symbols are ordered by their position in the file.

## Nesting

Local macros defined inside a program body appear as children of that program in the outline:

```stata
program my_analysis
    local input_file "data.dta"
    local output_file "results.dta"
    use `input_file', clear
    // ...
    save `output_file', replace
end
```

This produces an outline like:

```
my_analysis          (Program)
  `input_file'       (Local Macro)
  `output_file'      (Local Macro)
```

Local macros defined outside of any program appear at the top level.

## Code Sections

Structured comments create section entries in the outline, giving your `.do` files a table-of-contents-like navigation structure. Four comment patterns are recognized:

### 1. Single-line sections

A comment followed by text and a trailing delimiter (4+ repeated characters):

```stata
// Data Preparation ----
// Analysis ----------
* Results ====
```

### 2. Banner sections

A 3-line block with matching delimiter lines above and below:

```stata
// ============
// Data Loading
// ============
```

```stata
****
* Analysis
****
```

### 3. Starred inline sections

Text surrounded by 2+ asterisks on each side:

```stata
** Data Cleaning **
*** Regression Models ***
```

### 4. Numbered sections

A comment prefix followed by a number and section name. The number of dot-separated levels determines the nesting depth:

```stata
* 1 Introduction
* 1.1 Background
* 1.2 Data Sources
* 2 Analysis
* 2.1 Descriptive Statistics
```

This produces a nested outline:

```
1 Introduction         (Section)
  1.1 Background       (Section)
  1.2 Data Sources     (Section)
2 Analysis             (Section)
  2.1 Descriptive Statistics (Section)
```

### Section nesting levels

For single-line and banner sections, the nesting level is derived from the delimiter length:

| Delimiter Length | Level |
| --- | --- |
| 4 characters | 1 (top-level) |
| 5-7 characters | 2 |
| 8-11 characters | 3 |
| 12+ characters | 4 |

For example, longer delimiters produce higher-level (shallower) headings when you want to group sections:

```stata
// Main Analysis ============
// Subsection A ----
// Subsection B ----
```

Here `Main Analysis` is level 3 (11 `=` chars) and the subsections are level 1 (4 `-` chars), so the subsections nest under the main heading.

All symbols (programs, macros, variables, etc.) that fall within a section's range appear nested under that section in the outline.

## Workspace Symbol Search

Use `Cmd+T` / `Ctrl+T` to search for symbols across all files in the workspace. This searches programs, macros, variables, scalars, matrices, and embedded language blocks. The search is case-insensitive for convenience.
