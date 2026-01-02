# Design Document: By Varlist Parsing

## Overview

This feature completes the implementation of `by`/`bysort` prefix parsing in the Stata parser. The parser already has a `PrefixNode` type with a `varlist` field, but the actual varlist extraction is stubbed out. This design fills in that gap and adds support for `bysort` sort modifiers.

## Architecture

The change is localized to the parser's prefix handling code. No new components are needed.

```
Source: "bysort region (year): summarize income"
         │
         ▼
┌─────────────────────────────────────────────────┐
│ Parser.parseCommand()                           │
│                                                 │
│ 1. Detect prefix: "bysort" → isPrefixCommand()  │
│ 2. Parse varlist: ["region"]                    │
│ 3. Parse sort modifier: ["year"]                │
│ 4. Consume colon                                │
│ 5. Parse command: "summarize income"            │
└─────────────────────────────────────────────────┘
         │
         ▼
PrefixNode {
  type: 'prefix',
  name: 'bysort',
  fullName: 'bysort',
  varlist: ['region'],
  sortVars: ['year'],  // NEW field
  range: ...
}
```

## Components and Interfaces

### PrefixNode Extension

Add `sortVars` field to `PrefixNode` in `src/types/index.ts`:

```typescript
export interface PrefixNode {
  type: 'prefix';
  name: string;      // original text: 'by', 'bys', 'bysort'
  fullName: string;  // canonical: 'by' or 'bysort'
  varlist?: string[];
  sortVars?: string[];  // NEW: for bysort (sortvar) syntax
  range: Range;
}
```

### Parser Changes

Update `isPrefixCommand()` to include `bysort` and `bys`:

```typescript
private isPrefixCommand(word: string): boolean {
  const prefixes = [
    'by', 'bysort', 'bys',
    'quietly', 'qui', 'capture', 'cap', 'noisily'
  ];
  return prefixes.includes(word.toLowerCase());
}
```

Update prefix parsing in `parseCommand()`:

```typescript
// Handle 'by', 'bysort', 'bys' prefix with variable list
if (['by', 'bysort', 'bys'].includes(prefixToken.value.toLowerCase())) {
  const varlist: string[] = [];
  const sortVars: string[] = [];
  
  // Parse grouping variables until colon or open paren
  while (this.check('WORD') && !this.check('COLON')) {
    if (this.check('LPAREN')) break;
    varlist.push(this.advance().value);
  }
  
  // Parse optional sort modifier (sortvar)
  if (this.check('LPAREN')) {
    this.advance(); // consume (
    while (this.check('WORD') && !this.check('RPAREN')) {
      sortVars.push(this.advance().value);
    }
    if (this.check('RPAREN')) {
      this.advance(); // consume )
    }
  }
  
  // Expect and consume colon
  if (this.check('COLON')) {
    this.advance();
  } else {
    this.addError('Expected colon after by varlist', this.peek().range);
  }
  
  prefix.varlist = varlist.length > 0 ? varlist : undefined;
  prefix.sortVars = sortVars.length > 0 ? sortVars : undefined;
  prefix.fullName = prefixToken.value.toLowerCase() === 'by' ? 'by' : 'bysort';
}
```

### Pretty Printer Changes

Update `printPrefix()` in `src/pretty-printer/index.ts`:

```typescript
private printPrefix(prefix: PrefixNode): string {
  let result = prefix.name;

  // Handle 'by'/'bysort' prefix with variable list
  if (prefix.varlist && prefix.varlist.length > 0) {
    result += ' ' + prefix.varlist.join(' ');
  }
  
  // Handle sort modifier for bysort
  if (prefix.sortVars && prefix.sortVars.length > 0) {
    result += ' (' + prefix.sortVars.join(' ') + ')';
  }

  // Add colon for by/bysort prefix
  if (['by', 'bysort', 'bys'].includes(prefix.name.toLowerCase())) {
    result += ':';
  }

  return result;
}
```

## Data Models

### PrefixNode (updated)

| Field | Type | Description |
|-------|------|-------------|
| type | 'prefix' | Node type discriminator |
| name | string | Original source text ('by', 'bys', 'bysort') |
| fullName | string | Canonical form ('by' or 'bysort') |
| varlist | string[] | Grouping variables |
| sortVars | string[] | Sort modifier variables (bysort only) |
| range | Range | Source location |

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do.*

### Property 1: By-prefix Varlist Extraction

*For any* valid `by`, `bysort`, or `bys` prefix with a varlist, the parser SHALL extract all variables in source order and attach them to the PrefixNode.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**

### Property 2: Sort Modifier Separation

*For any* `bysort` prefix with a sort modifier `(sortvar)`, the parser SHALL correctly separate grouping variables from sort variables, preserving order in both lists.

**Validates: Requirements 2.1, 2.2, 2.3**

### Property 3: Round-trip Consistency

*For any* valid by-prefix command, parsing then pretty-printing SHALL produce syntactically equivalent output (the varlist and sort modifier are preserved).

**Validates: Requirements 3.3, 3.4**

### Property 4: Analyzer Scope Checking

*For any* variable in a by-prefix varlist, the analyzer SHALL include it in undefined variable checking and report diagnostics for undefined variables.

**Validates: Requirements 4.1, 4.2**

## Error Handling

| Error Condition | Handling |
|-----------------|----------|
| Missing colon after by varlist | Report error, attempt to continue parsing |
| Empty varlist (`by: cmd`) | Report error, parse command anyway |
| Unclosed sort modifier paren | Report error, treat as end of sort vars |
| `by` without colon (standalone command) | Parse as regular command, not prefix |

## Testing Strategy

### Property-Based Tests (fast-check)

1. **Varlist extraction property**: Generate random varlists (1-5 variables), parse `by varlist: cmd`, verify all variables extracted in order.

2. **Sort modifier property**: Generate random grouping + sort varlists, parse `bysort group (sort): cmd`, verify separation.

3. **Round-trip property**: Generate random by-prefix commands, verify `print(parse(source))` produces equivalent syntax.

4. **Analyzer property**: Generate by-prefix commands with mix of defined/undefined variables, verify diagnostics.

### Unit Tests

- Parse `by region: summarize` → varlist = ['region']
- Parse `by region year: summarize` → varlist = ['region', 'year']
- Parse `bysort region (year): summarize` → varlist = ['region'], sortVars = ['year']
- Parse `bys region: summarize` → fullName = 'bysort', varlist = ['region']
- Parse `by: summarize` → error reported, command still parsed
- Parse `by region summarize` (no colon) → error reported
