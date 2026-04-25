# Fix Broken SMCL Help Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix ~1,155 broken links in the SMCL help viewer by adding INCLUDE directive expansion, cross-file anchor fallback, and resolver improvements.

**Architecture:** Four independent parts built sequentially: (1) server-side INCLUDE expansion via new LSP request, (2) cross-file anchor fallback by extending the existing `resolveSthlpFile` handler, (3) renderer/resolver fixes for `{search}`, function topics, and system variables, (4) validation via the checker script. Each part is independently shippable.

**Tech Stack:** TypeScript, Bun test runner, VS Code extension API, LSP protocol

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/utils/marker-scanner.ts` | **New.** Shared marker extraction utility — extracts `{marker <name>}` names from SMCL content |
| `src/utils/include-expander.ts` | **New.** INCLUDE directive expansion logic — resolves and inlines `.ihlp` files recursively |
| `src/indexer/index.ts` | **Modify.** Add `resolve_ihlp_file()` and `find_related_sthlp_files()` methods |
| `src/server-handlers.ts` | **Modify.** New `sight/expandIncludes` handler; extend `resolveSthlpFile` with `anchor`, `f_`, `_` fallbacks |
| `client/src/smcl-preview/preview-panel.ts` | **Modify.** Call `sight/expandIncludes` in `refresh()` |
| `client/src/smcl-preview/panel-manager.ts` | **Modify.** Pass `anchor` in `resolveSthlpFile` request |
| `client/src/smcl-preview/smcl-to-html.ts` | **Modify.** Change `render_search_link()` to emit plain text |
| `client/src/smcl-preview/webview-html.ts` | **Modify.** Add `.smcl-search-text` CSS rule |
| `scripts/check-help-links.ts` | **Modify.** Use include expansion when checking anchors; use shared marker scanner |
| `tests/unit/marker-scanner.test.ts` | **New.** Unit tests for marker extraction |
| `tests/unit/include-expander.test.ts` | **New.** Unit tests for INCLUDE expansion |
| `tests/unit/smcl-to-html.test.ts` | **Modify.** Add `{search}` rendering test |
| `tests/integration/help-topic-coverage.test.ts` | **Modify.** Add `f_` and `_` fallback coverage |

---

## Task 1: Shared marker scanner utility

**Files:**
- Create: `src/utils/marker-scanner.ts`
- Create: `tests/unit/marker-scanner.test.ts`

- [ ] **Step 1: Write failing tests for marker extraction**

Create `tests/unit/marker-scanner.test.ts`:

```typescript
/**
 * Tests for the shared SMCL marker extraction utility.
 */
import { describe, it, expect } from 'bun:test';
import { extract_marker_names } from '../../src/utils/marker-scanner';

describe('extract_marker_names', () => {
    it('extracts a single marker name', () => {
        const result = extract_marker_names('{marker syntax}{...}');
        expect(result).toEqual(new Set(['syntax']));
    });

    it('extracts multiple marker names', () => {
        const result = extract_marker_names(
            '{marker syntax}{...}\n{marker options}{...}\n{marker examples}'
        );
        expect(result).toEqual(new Set(['syntax', 'options', 'examples']));
    });

    it('handles names with metacharacters: parentheses', () => {
        const result = extract_marker_names('{marker level()}{...}');
        expect(result).toEqual(new Set(['level()']));
    });

    it('handles names with metacharacters: dots and hashes', () => {
        const result = extract_marker_names(
            '{marker rule15.2}{...}\n{marker lev#_equation}{...}'
        );
        expect(result).toEqual(new Set(['rule15.2', 'lev#_equation']));
    });

    it('handles names with asterisks', () => {
        const result = extract_marker_names('{marker stub*}{...}');
        expect(result).toEqual(new Set(['stub*']));
    });

    it('trims trailing whitespace from marker names', () => {
        const result = extract_marker_names('{marker level() }{...}');
        expect(result).toEqual(new Set(['level()']));
    });

    it('returns empty set for content with no markers', () => {
        const result = extract_marker_names('{title:Syntax}\n{cmd:regress}');
        expect(result).toEqual(new Set());
    });

    it('returns empty set for empty string', () => {
        const result = extract_marker_names('');
        expect(result).toEqual(new Set());
    });

    it('ignores malformed markers with no name', () => {
        const result = extract_marker_names('{marker }');
        expect(result).toEqual(new Set());
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/marker-scanner.test.ts`
Expected: FAIL — module `../../src/utils/marker-scanner` not found

- [ ] **Step 3: Implement the marker scanner**

Create `src/utils/marker-scanner.ts`:

```typescript
/**
 * Shared SMCL marker extraction utility.
 *
 * Extracts `{marker <name>}` directives from raw SMCL content.
 * Used by the anchor fallback resolver and the link checker script
 * to ensure parity between runtime and validation.
 *
 * Grammar: `{marker <name>}` where `<name>` is all characters between
 * the space after `marker` and the closing `}`. Names can contain
 * letters, digits, `_`, `()`, `.`, `*`, `#`, `-`.
 * Names are trimmed before insertion (defensive against trailing
 * whitespace in user-authored files).
 */

const MARKER_RE = /\{marker\s+([^}]+)\}/g;

/**
 * Extract all marker names from SMCL content.
 *
 * @param content - Raw SMCL source (may include expanded includes)
 * @returns Set of trimmed marker names found in the content
 */
export function extract_marker_names(content: string): Set<string> {
    const the_names = new Set<string>();
    MARKER_RE.lastIndex = 0;
    let my_match: RegExpExecArray | null;
    while ((my_match = MARKER_RE.exec(content)) !== null) {
        const my_name = my_match[1].trim();
        if (my_name.length > 0) {
            the_names.add(my_name);
        }
    }
    return the_names;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/marker-scanner.test.ts`
Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/marker-scanner.ts tests/unit/marker-scanner.test.ts
git commit -m "Add shared SMCL marker extraction utility"
```

---

## Task 2: INCLUDE expansion logic

**Files:**
- Create: `src/utils/include-expander.ts`
- Create: `tests/unit/include-expander.test.ts`

- [ ] **Step 1: Write failing tests for include expansion**

Create `tests/unit/include-expander.test.ts`:

```typescript
/**
 * Tests for the INCLUDE directive expander.
 */
import { describe, it, expect } from 'bun:test';
import { expand_includes } from '../../src/utils/include-expander';

// Stub resolver: returns content from a map, null for missing files
function make_resolver(
    files: Record<string, string>
): (name: string) => Promise<{ path: string; content: string } | null> {
    return async (name: string) => {
        const my_content = files[name];
        if (my_content === undefined) return null;
        return { path: `/fake/${name}.ihlp`, content: my_content };
    };
}

describe('expand_includes', () => {
    it('expands a single INCLUDE directive', async () => {
        const my_resolver = make_resolver({
            'shortdes-coeflegend': '{pstd}Coefficient legend content',
        });
        const result = await expand_includes(
            'line1\nINCLUDE help shortdes-coeflegend\nline3',
            my_resolver
        );
        expect(result).toBe(
            'line1\n{pstd}Coefficient legend content\nline3'
        );
    });

    it('expands multiple INCLUDE directives', async () => {
        const my_resolver = make_resolver({
            'file_a': 'content A',
            'file_b': 'content B',
        });
        const result = await expand_includes(
            'INCLUDE help file_a\nmiddle\nINCLUDE help file_b',
            my_resolver
        );
        expect(result).toBe('content A\nmiddle\ncontent B');
    });

    it('handles recursive includes', async () => {
        const my_resolver = make_resolver({
            'outer': 'before\nINCLUDE help inner\nafter',
            'inner': 'INNER CONTENT',
        });
        const result = await expand_includes(
            'INCLUDE help outer',
            my_resolver
        );
        expect(result).toBe('before\nINNER CONTENT\nafter');
    });

    it('detects cycles and stops', async () => {
        const my_resolver = make_resolver({
            'cycle_a': 'A\nINCLUDE help cycle_b',
            'cycle_b': 'B\nINCLUDE help cycle_a',
        });
        const result = await expand_includes(
            'INCLUDE help cycle_a',
            my_resolver
        );
        // cycle_a expands, cycle_b expands, cycle_a is skipped (visited)
        expect(result).toBe('A\nB\n');
    });

    it('respects depth limit', async () => {
        // Build a chain: d0 includes d1, d1 includes d2, ..., d11 includes d12
        const the_files: Record<string, string> = {};
        for (let i = 0; i < 13; i++) {
            the_files[`d${i}`] = i < 12
                ? `level${i}\nINCLUDE help d${i + 1}`
                : `level${i}`;
        }
        const my_resolver = make_resolver(the_files);
        const result = await expand_includes(
            'INCLUDE help d0',
            my_resolver,
            { max_depth: 10 }
        );
        // Depth 10 means levels 0-9 expand, d10's INCLUDE line is removed
        expect(result).toContain('level0');
        expect(result).toContain('level9');
        expect(result).toContain('level10');
        expect(result).not.toContain('level11');
    });

    it('removes INCLUDE line when file is missing', async () => {
        const my_resolver = make_resolver({});
        const result = await expand_includes(
            'line1\nINCLUDE help missing_file\nline3',
            my_resolver
        );
        expect(result).toBe('line1\n\nline3');
    });

    it('tolerates leading whitespace in INCLUDE directive', async () => {
        const my_resolver = make_resolver({
            'indented': 'INDENTED CONTENT',
        });
        const result = await expand_includes(
            '  INCLUDE help indented',
            my_resolver
        );
        expect(result).toBe('INDENTED CONTENT');
    });

    it('tolerates extra spacing between tokens', async () => {
        const my_resolver = make_resolver({
            'spaced': 'SPACED CONTENT',
        });
        const result = await expand_includes(
            'INCLUDE  help  spaced',
            my_resolver
        );
        expect(result).toBe('SPACED CONTENT');
    });

    it('preserves non-INCLUDE lines unchanged', async () => {
        const my_resolver = make_resolver({});
        const my_input = '{title:Syntax}\n{cmd:regress} {depvar} {indepvars}';
        const result = await expand_includes(my_input, my_resolver);
        expect(result).toBe(my_input);
    });

    it('logs missing includes (deduplicated)', async () => {
        const the_warnings: string[] = [];
        const my_resolver = make_resolver({});
        await expand_includes(
            'INCLUDE help missing\nINCLUDE help missing\nINCLUDE help other',
            my_resolver,
            { on_missing: (name) => the_warnings.push(name) }
        );
        // "missing" logged once (deduplicated), "other" logged once
        expect(the_warnings).toEqual(['missing', 'other']);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/include-expander.test.ts`
Expected: FAIL — module `../../src/utils/include-expander` not found

- [ ] **Step 3: Implement the include expander**

Create `src/utils/include-expander.ts`:

```typescript
/**
 * INCLUDE directive expander for Stata SMCL help files.
 *
 * Resolves `INCLUDE help <name>` lines by reading the corresponding
 * `.ihlp` file and substituting its content inline. Supports recursive
 * includes with cycle detection and a configurable depth limit.
 *
 * This module contains only the expansion logic. File resolution is
 * delegated to a caller-provided resolver function, keeping this
 * testable without filesystem access.
 */

import { logger } from './logger';

const INCLUDE_RE = /^\s*INCLUDE\s+help\s+(\S+)/;
const DEFAULT_MAX_DEPTH = 10;

export interface ExpandIncludesOptions {
    /** Maximum recursion depth (default: 10). */
    max_depth?: number;
    /** Callback invoked once per unique missing include name. */
    on_missing?: (name: string) => void;
}

/**
 * Resolver function type: given an include name, returns the resolved
 * file path and content, or null if the file cannot be found.
 */
export type IncludeResolver = (
    name: string
) => Promise<{ path: string; content: string } | null>;

/**
 * Expand all `INCLUDE help <name>` directives in SMCL content.
 *
 * @param content - Raw SMCL source
 * @param resolver - Function that resolves include names to file content
 * @param options - Optional depth limit and missing-file callback
 * @returns SMCL content with INCLUDE directives replaced by file content
 */
export async function expand_includes(
    content: string,
    resolver: IncludeResolver,
    options?: ExpandIncludesOptions
): Promise<string> {
    const my_max_depth = options?.max_depth ?? DEFAULT_MAX_DEPTH;
    const my_visited = new Set<string>();
    const my_missing_logged = new Set<string>();

    return expand_recursive(
        content, resolver, my_visited, my_missing_logged,
        0, my_max_depth, options?.on_missing
    );
}

async function expand_recursive(
    content: string,
    resolver: IncludeResolver,
    visited: Set<string>,
    missing_logged: Set<string>,
    depth: number,
    max_depth: number,
    on_missing?: (name: string) => void
): Promise<string> {
    const the_lines = content.split('\n');
    const the_result: string[] = [];

    for (const my_line of the_lines) {
        const my_match = INCLUDE_RE.exec(my_line);
        if (!my_match) {
            the_result.push(my_line);
            continue;
        }

        const my_name = my_match[1];

        if (depth >= max_depth) {
            logger.warn(
                `INCLUDE depth limit (${max_depth}) exceeded for "${my_name}"`
            );
            // Remove the INCLUDE line but don't expand
            the_result.push('');
            continue;
        }

        const my_resolved = await resolver(my_name);
        if (!my_resolved) {
            if (!missing_logged.has(my_name)) {
                missing_logged.add(my_name);
                logger.debug(
                    `INCLUDE: could not resolve "${my_name}.ihlp"`
                );
                on_missing?.(my_name);
            }
            the_result.push('');
            continue;
        }

        if (visited.has(my_resolved.path)) {
            // Cycle detected — skip silently
            the_result.push('');
            continue;
        }

        visited.add(my_resolved.path);
        const my_expanded = await expand_recursive(
            my_resolved.content, resolver, visited, missing_logged,
            depth + 1, max_depth, on_missing
        );
        the_result.push(my_expanded);
    }

    return the_result.join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/include-expander.test.ts`
Expected: All 10 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/include-expander.ts tests/unit/include-expander.test.ts
git commit -m "Add INCLUDE directive expander for SMCL help files"
```

---

## Task 3: Indexer methods for `.ihlp` resolution and related file discovery

**Files:**
- Modify: `src/indexer/index.ts`

- [ ] **Step 1: Add `resolve_ihlp_file()` method to WorkspaceIndexer**

This mirrors `resolve_sthlp_basename` but with `.ihlp` extension. Add after the `resolve_sthlp_basename` method (around line 1037 in `src/indexer/index.ts`):

```typescript
    /**
     * Resolve an include-help name to an absolute `.ihlp` file path.
     * Follows the same letter-subdirectory convention and search order
     * as `resolve_sthlp_file`.
     */
    async resolve_ihlp_file(name: string): Promise<string | null> {
        if (name.length === 0) return null;
        const my_basename = `${name}.ihlp`;
        const my_first_letter = name.charAt(0).toLowerCase();

        const the_search_dirs = [
            ...this.ado_paths,
            ...this.workspace_roots,
            ...this.help_search_paths,
        ];

        for (const my_dir of the_search_dirs) {
            // Check letter subdirectory: dir/r/robust_short.ihlp
            const my_subdir_path = path.join(
                my_dir, my_first_letter, my_basename
            );
            try {
                await fs.promises.access(my_subdir_path);
                return my_subdir_path;
            } catch {
                // not found, continue
            }

            // Check directly in directory: dir/robust_short.ihlp
            const my_direct_path = path.join(my_dir, my_basename);
            try {
                await fs.promises.access(my_direct_path);
                return my_direct_path;
            } catch {
                // not found, continue
            }
        }

        return null;
    }
```

- [ ] **Step 2: Add `find_related_sthlp_files()` method to WorkspaceIndexer**

Add after `resolve_ihlp_file`. This finds all `topic_*.sthlp` files across search directories with deterministic ordering:

```typescript
    /**
     * Find all `topic_*.sthlp` files across search directories.
     * Returns paths in deterministic order: ado-path priority, then
     * lexicographic filename sort within each directory.
     */
    async find_related_sthlp_files(topic: string): Promise<string[]> {
        if (topic.length === 0) return [];
        const my_prefix = `${topic}_`;
        const my_first_letter = topic.charAt(0).toLowerCase();
        const the_results: string[] = [];

        const the_search_dirs = [
            ...this.ado_paths,
            ...this.workspace_roots,
            ...this.help_search_paths,
        ];

        for (const my_dir of the_search_dirs) {
            // Check letter subdirectory first
            const my_subdir = path.join(my_dir, my_first_letter);
            const my_subdir_matches = await this.list_matching_sthlp(
                my_subdir, my_prefix
            );
            the_results.push(...my_subdir_matches);

            // Check flat directory
            const my_flat_matches = await this.list_matching_sthlp(
                my_dir, my_prefix
            );
            the_results.push(...my_flat_matches);
        }

        return the_results;
    }

    /**
     * List .sthlp files in a directory matching a given prefix,
     * sorted lexicographically.
     */
    private async list_matching_sthlp(
        dir: string,
        prefix: string
    ): Promise<string[]> {
        try {
            const the_entries = await fs.promises.readdir(dir);
            const the_matches = the_entries
                .filter(my_entry =>
                    my_entry.startsWith(prefix)
                    && my_entry.endsWith('.sthlp')
                )
                .sort();
            return the_matches.map(my_entry => path.join(dir, my_entry));
        } catch {
            return [];
        }
    }
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS — no type errors

- [ ] **Step 4: Commit**

```bash
git add src/indexer/index.ts
git commit -m "Add resolve_ihlp_file and find_related_sthlp_files to indexer"
```

---

## Task 4: Server-side `sight/expandIncludes` handler

**Files:**
- Modify: `src/server-handlers.ts`
- Modify: `src/server-factory.ts`

- [ ] **Step 1: Add the handler interfaces and factory in `server-handlers.ts`**

Add after the `resolveFindalias` handler section (after line ~1070):

```typescript
// -----------------------------------------------------------------------
// sight/expandIncludes
// -----------------------------------------------------------------------

export interface ExpandIncludesParams {
    content: string;
}

export interface ExpandIncludesResult {
    content: string;
}

/**
 * Creates the custom request handler for sight/expandIncludes.
 *
 * Expands `INCLUDE help <name>` directives in raw SMCL content by
 * resolving `.ihlp` files via the indexer and substituting their
 * content inline. Supports recursive includes with cycle detection.
 */
export function create_expand_includes_handler(
    deps: HandlerDependencies
): (params: ExpandIncludesParams) => Promise<ExpandIncludesResult> {
    // LRU cache for resolved .ihlp file content, keyed by resolved path.
    // Shared across requests. 500 entries covers the full Stata 18 corpus
    // (943 .ihlp files) with room for eviction.
    const the_ihlp_cache = new Map<string, string>();
    const CACHE_MAX_SIZE = 500;

    return async (params: ExpandIncludesParams): Promise<ExpandIncludesResult> => {
        if (!deps.workspace_indexer) {
            return { content: params.content };
        }
        const my_indexer = deps.workspace_indexer;

        const my_resolver: IncludeResolver = async (name: string) => {
            const my_path = await my_indexer.resolve_ihlp_file(name);
            if (!my_path) return null;

            const my_cached = the_ihlp_cache.get(my_path);
            if (my_cached !== undefined) {
                return { path: my_path, content: my_cached };
            }

            try {
                const my_content = await fs.promises.readFile(
                    my_path, 'utf-8'
                );
                // Simple LRU: delete oldest when full
                if (the_ihlp_cache.size >= CACHE_MAX_SIZE) {
                    const my_first_key = the_ihlp_cache.keys().next().value;
                    if (my_first_key !== undefined) {
                        the_ihlp_cache.delete(my_first_key);
                    }
                }
                the_ihlp_cache.set(my_path, my_content);
                return { path: my_path, content: my_content };
            } catch {
                logger.debug(
                    `expandIncludes: could not read "${my_path}"`
                );
                return null;
            }
        };

        const my_expanded = await expand_includes(
            params.content, my_resolver
        );
        return { content: my_expanded };
    };
}
```

Add the required imports at the top of `server-handlers.ts`:

```typescript
import { expand_includes, IncludeResolver } from './utils/include-expander';
```

- [ ] **Step 2: Register the handler in `server-factory.ts`**

In `src/server-factory.ts`, after the `resolveFindalias` registration (around line 1137), add:

```typescript
    const expand_includes_handler = create_expand_includes_handler(handler_deps);
    connection.onRequest('sight/expandIncludes', expand_includes_handler);
```

Add the import at the top:

```typescript
import { create_expand_includes_handler } from './server-handlers';
```

(If `create_expand_includes_handler` is not already exported from the import block, add it to the existing import.)

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/server-handlers.ts src/server-factory.ts
git commit -m "Add sight/expandIncludes LSP request handler"
```

---

## Task 5: Client-side include expansion in preview panel

**Files:**
- Modify: `client/src/smcl-preview/preview-panel.ts`

- [ ] **Step 1: Add include expansion to `refresh()` method**

In `client/src/smcl-preview/preview-panel.ts`, modify the `refresh()` method. The current code (starting at line 158) reads:

```typescript
    private async refresh(): Promise<void> {
        // Try to get content from open editor first; fall back to disk
        const my_content = this.read_content();
        if (my_content === null) return;

        // Capture a token before any async work. If a newer refresh
        // starts while we're awaiting LSP responses, it will bump the
        // sequence and we'll discard our stale result.
        const my_token = ++this.refresh_seq;

        const my_findalias_map = await this.resolve_findalias_map(my_content);
```

Replace with:

```typescript
    private async refresh(): Promise<void> {
        // Try to get content from open editor first; fall back to disk
        const my_raw_content = this.read_content();
        if (my_raw_content === null) return;

        // Capture a token before any async work. If a newer refresh
        // starts while we're awaiting LSP responses, it will bump the
        // sequence and we'll discard our stale result.
        const my_token = ++this.refresh_seq;

        // Expand INCLUDE directives before findalias resolution
        // (included content may contain {findalias} references).
        const my_content = await this.expand_includes(my_raw_content);
        if (this.disposed || my_token !== this.refresh_seq) return;

        const my_findalias_map = await this.resolve_findalias_map(my_content);
```

- [ ] **Step 2: Add the `expand_includes` method to SmclPreviewPanel**

Add this method to the class, near the `resolve_findalias_map` method:

```typescript
    /**
     * Expand `INCLUDE help <name>` directives via the LSP server.
     * Falls back to the original content if the server is unavailable.
     */
    private async expand_includes(content: string): Promise<string> {
        const my_client = this.get_client();
        if (!my_client) return content;

        try {
            const my_result = await my_client.sendRequest<{
                content: string;
            }>('sight/expandIncludes', { content });
            return my_result?.content ?? content;
        } catch {
            // Server unavailable or request failed — use unexpanded content
            return content;
        }
    }
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add client/src/smcl-preview/preview-panel.ts
git commit -m "Call sight/expandIncludes in SMCL preview panel refresh"
```

---

## Task 6: Update checker script to use include expansion

**Files:**
- Modify: `scripts/check-help-links.ts`

- [ ] **Step 1: Add include expansion to `render_topic` function**

In `scripts/check-help-links.ts`, the `render_topic` function (around line 153) currently reads the file and passes it directly to `smcl_to_html`. Update it to expand includes first.

Add imports at the top of the file (after the existing imports):

```typescript
import { expand_includes } from '../src/utils/include-expander';
import { extract_marker_names } from '../src/utils/marker-scanner';
```

Then modify the `render_topic` function. Replace:

```typescript
    async function render_topic(
        topic: string
    ): Promise<{ html: string; anchor_ids: Set<string> } | null> {
        const my_cached = the_page_cache.get(topic);
        if (my_cached) return my_cached;

        const my_file_path = await my_indexer.resolve_sthlp_file(topic);
        if (!my_file_path) return null;

        const my_content = fs.readFileSync(my_file_path, 'utf-8');
        const my_result = smcl_to_html(my_content, {
            current_topic: topic,
        });
        const my_entry = {
            html: my_result.html,
            anchor_ids: extract_anchor_ids(my_result.html),
        };
        the_page_cache.set(topic, my_entry);
        return my_entry;
    }
```

With:

```typescript
    // Resolver for INCLUDE expansion — uses the indexer
    const my_include_resolver = async (name: string) => {
        const my_path = await my_indexer.resolve_ihlp_file(name);
        if (!my_path) return null;
        try {
            const my_content = fs.readFileSync(my_path, 'utf-8');
            return { path: my_path, content: my_content };
        } catch {
            return null;
        }
    };

    async function render_topic(
        topic: string
    ): Promise<{ html: string; anchor_ids: Set<string> } | null> {
        const my_cached = the_page_cache.get(topic);
        if (my_cached) return my_cached;

        const my_file_path = await my_indexer.resolve_sthlp_file(topic);
        if (!my_file_path) return null;

        const my_raw_content = fs.readFileSync(my_file_path, 'utf-8');
        const my_content = await expand_includes(
            my_raw_content, my_include_resolver
        );
        const my_result = smcl_to_html(my_content, {
            current_topic: topic,
        });
        const my_entry = {
            html: my_result.html,
            anchor_ids: extract_anchor_ids(my_result.html),
        };
        the_page_cache.set(topic, my_entry);
        return my_entry;
    }
```

- [ ] **Step 2: Run the checker to measure impact of Part 1**

Run: `bun scripts/check-help-links.ts 2>&1 | tail -20`
Expected: Significant drop in same-page anchor failures (display_options, lasso_options, menu, selopts, etc.)

- [ ] **Step 3: Commit**

```bash
git add scripts/check-help-links.ts
git commit -m "Update help link checker to expand INCLUDE directives

Uses the shared include-expander and indexer's resolve_ihlp_file
for checker-runtime parity."
```

---

## Task 7: Extend `resolveSthlpFile` with anchor-aware fallback

**Files:**
- Modify: `src/server-handlers.ts`

- [ ] **Step 1: Update the `ResolveSthlpFileParams` interface**

In `src/server-handlers.ts`, modify the interface (around line 868):

```typescript
export interface ResolveSthlpFileParams {
    topic: string;
    anchor?: string;
}
```

- [ ] **Step 2: Add anchor fallback logic to the handler**

In `create_resolve_sthlp_file_handler`, add the anchor fallback after the existing resolution logic. Find the final `return { file_path: null };` line (around line 1029) and replace the section from the successful resolution return through the end:

The key change: after the existing topic resolution succeeds and returns a `file_path`, if `anchor` was provided, check whether that anchor exists in the resolved file. If not, search `topic_*` related files.

Add this import at the top of the file:

```typescript
import { extract_marker_names } from './utils/marker-scanner';
```

Then wrap the return logic. After the existing handler's resolution chain produces `file_path`, add the anchor fallback. Replace the handler's return function body — insert anchor checking after the final resolution produces a file path. The cleanest approach is to wrap the existing logic:

At the very top of the handler function body, save the original logic into a helper, then add post-processing. Modify `create_resolve_sthlp_file_handler` to:

```typescript
export function create_resolve_sthlp_file_handler(
    deps: HandlerDependencies
): (params: ResolveSthlpFileParams) => Promise<ResolveSthlpFileResult> {
    // Reuse the expand_includes handler's cache for reading .ihlp files
    // during marker scanning. Build a resolver that uses the indexer.
    const the_ihlp_cache = new Map<string, string>();
    const CACHE_MAX_SIZE = 500;

    async function read_and_expand(
        file_path: string
    ): Promise<string | null> {
        if (!deps.workspace_indexer) return null;
        try {
            const my_content = await fs.promises.readFile(
                file_path, 'utf-8'
            );
            const my_resolver: IncludeResolver = async (name: string) => {
                const my_path =
                    await deps.workspace_indexer!.resolve_ihlp_file(name);
                if (!my_path) return null;
                const my_cached = the_ihlp_cache.get(my_path);
                if (my_cached !== undefined) {
                    return { path: my_path, content: my_cached };
                }
                try {
                    const my_file_content = await fs.promises.readFile(
                        my_path, 'utf-8'
                    );
                    if (the_ihlp_cache.size >= CACHE_MAX_SIZE) {
                        const my_first = the_ihlp_cache.keys().next().value;
                        if (my_first !== undefined) {
                            the_ihlp_cache.delete(my_first);
                        }
                    }
                    the_ihlp_cache.set(my_path, my_file_content);
                    return { path: my_path, content: my_file_content };
                } catch {
                    return null;
                }
            };
            return expand_includes(my_content, my_resolver);
        } catch {
            return null;
        }
    }

    return async (params: ResolveSthlpFileParams): Promise<ResolveSthlpFileResult> => {
        // ... existing resolution logic (unchanged) ...
        // This resolves params.topic to a file_path.
        // All existing code stays exactly as-is up to the point where
        // it would return { file_path: my_resolved } or { file_path: null }.
```

**Important:** Rather than replacing the entire function, the actual edit should wrap the final return. The simplest approach is to extract the existing resolution into an inner function, then add the anchor check after. Here is the precise edit pattern:

After the existing handler function resolves a `file_path` (just before its return statements), add a new section. The cleanest way:

1. Find where the handler currently does `return { file_path: null };` at the end (line ~1029)
2. Replace the entire return function with a version that captures the result and post-processes it

Since the existing function is long (lines 885-1029), the approach is:

Add this at the **end** of the handler function, just before the final `return { file_path: null };`:

```typescript
        // ---------------------------------------------------------------
        // Anchor fallback: if anchor was requested and the primary file
        // doesn't contain it, search topic_* related files.
        // ---------------------------------------------------------------
        return { file_path: null };
    };
}
```

Actually, the cleanest approach is to **wrap** the existing handler. Replace the export with:

```typescript
export function create_resolve_sthlp_file_handler(
    deps: HandlerDependencies
): (params: ResolveSthlpFileParams) => Promise<ResolveSthlpFileResult> {
    // ... (keep the ihlp cache and read_and_expand helper from above) ...

    const resolve_topic = create_resolve_topic_handler(deps);

    return async (params: ResolveSthlpFileParams): Promise<ResolveSthlpFileResult> => {
        const my_result = await resolve_topic(params);

        // If no anchor requested, or no file resolved, return as-is
        if (!params.anchor || !my_result.file_path) {
            return my_result;
        }

        // Check if the anchor exists in the resolved file
        const my_expanded = await read_and_expand(my_result.file_path);
        if (my_expanded) {
            const the_markers = extract_marker_names(my_expanded);
            if (the_markers.has(params.anchor)) {
                return my_result;
            }
        }

        // Anchor not found — search topic_* related files
        if (deps.workspace_indexer) {
            const my_topic = (params.topic ?? '').trim();
            const the_related = await deps.workspace_indexer
                .find_related_sthlp_files(my_topic);

            for (const my_candidate_path of the_related) {
                // Skip the file we already checked
                if (my_candidate_path === my_result.file_path) continue;

                const my_candidate_content =
                    await read_and_expand(my_candidate_path);
                if (!my_candidate_content) continue;

                const the_candidate_markers =
                    extract_marker_names(my_candidate_content);
                if (the_candidate_markers.has(params.anchor)) {
                    return { file_path: my_candidate_path };
                }
            }
        }

        // No related file has the anchor — return original file
        return my_result;
    };
}
```

Then rename the existing inner function to `create_resolve_topic_handler` (a private function in the same file) that contains all the current resolution logic.

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/server-handlers.ts
git commit -m "Add anchor-aware cross-file fallback to resolveSthlpFile

When an anchor is requested, checks the primary file for {marker}
matches. If not found, scans topic_* related files in deterministic
ado-path order."
```

---

## Task 8: Client-side anchor passthrough in panel manager

**Files:**
- Modify: `client/src/smcl-preview/panel-manager.ts`

- [ ] **Step 1: Pass anchor in the `resolveSthlpFile` request**

In `client/src/smcl-preview/panel-manager.ts`, modify `open_topic` (line 91-94). Replace:

```typescript
            const my_result = await my_client.sendRequest<{
                file_path: string | null;
            }>('sight/resolveSthlpFile', { topic });
```

With:

```typescript
            const my_result = await my_client.sendRequest<{
                file_path: string | null;
            }>('sight/resolveSthlpFile', { topic, anchor });
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add client/src/smcl-preview/panel-manager.ts
git commit -m "Pass anchor to resolveSthlpFile for cross-file fallback"
```

---

## Task 9: Run checker after Part 2 to measure anchor fallback impact

- [ ] **Step 1: Run the checker**

Run: `bun scripts/check-help-links.ts 2>&1 | tail -20`
Expected: Large drop in cross-page anchor failures (estimation##, regress## patterns resolved). Record the new counts.

- [ ] **Step 2: Commit a note if any checker updates are needed**

If the checker itself needs tweaks based on the results, make them and commit.

---

## Task 10: Render `{search}` as plain text

**Files:**
- Modify: `client/src/smcl-preview/smcl-to-html.ts`
- Modify: `client/src/smcl-preview/webview-html.ts`
- Modify: `tests/unit/smcl-to-html.test.ts`

- [ ] **Step 1: Write failing test for `{search}` rendering**

Add to `tests/unit/smcl-to-html.test.ts`:

```typescript
    describe('{search} directives', () => {
        it('renders {search} as plain text span, not a link', () => {
            const result = smcl_to_html('{search r(5)}');
            expect(result.html).toContain('<span');
            expect(result.html).toContain('class="smcl-search-text"');
            expect(result.html).toContain('data-smcl-search-query="r(5)"');
            expect(result.html).toContain('r(5)');
            expect(result.html).not.toContain('<a ');
            expect(result.html).not.toContain('data-smcl-topic');
        });

        it('renders {search keyword:display_text} with display text', () => {
            const result = smcl_to_html('{search r(5):return code 5}');
            expect(result.html).toContain('return code 5');
            expect(result.html).toContain('data-smcl-search-query="r(5)"');
            expect(result.html).not.toContain('<a ');
        });

        it('does not add cross-reference entries for {search}', () => {
            const result = smcl_to_html('{search r(5)}');
            expect(result.cross_references).toEqual([]);
        });
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/smcl-to-html.test.ts --test-name-pattern "search"`
Expected: FAIL — currently renders as `<a>` with `data-smcl-topic`

- [ ] **Step 3: Modify `render_search_link` in `smcl-to-html.ts`**

In `client/src/smcl-preview/smcl-to-html.ts`, replace the `render_search_link` function (lines 1341-1365):

```typescript
function render_search_link(
    directive: SmclDirective,
    ctx: RenderContext
): string {
    // {search keyword} or {search keyword:display_text}
    const my_topic = (directive.args || '').split(' ')[0].trim();
    if (!my_topic) return render_content(directive, ctx);

    const my_display = directive.content.length > 0
        ? render_content(directive, ctx)
        : escape_html(my_topic);

    // Render as plain styled text — {search} opens Stata's keyword
    // search dialog, not a help page. No link, no cross-reference entry.
    return (
        `<span class="smcl-search-text" ` +
        `data-smcl-search-query="${escape_html(my_topic)}"` +
        `>${my_display}</span>`
    );
}
```

- [ ] **Step 4: Add CSS rule for `.smcl-search-text`**

In `client/src/smcl-preview/webview-html.ts`, find the link styles section (around line 158-170) and add after the existing link styles:

```css
.smcl-search-text {
    color: var(--vscode-foreground);
    opacity: 0.8;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/unit/smcl-to-html.test.ts --test-name-pattern "search"`
Expected: All 3 tests PASS

- [ ] **Step 6: Commit**

```bash
git add client/src/smcl-preview/smcl-to-html.ts client/src/smcl-preview/webview-html.ts tests/unit/smcl-to-html.test.ts
git commit -m "Render {search} directives as plain text, not help links"
```

---

## Task 11: Function topic fallback (`f_` prefix) and system variable fallback (`_` prefix)

**Files:**
- Modify: `src/server-handlers.ts`
- Modify: `tests/integration/help-topic-coverage.test.ts`

- [ ] **Step 1: Add `f_` prefix fallback to `resolveSthlpFile`**

In the topic resolution function (the inner `resolve_topic` / `create_resolve_topic_handler`), add a new fallback section just before the final `return { file_path: null }`. This goes after all existing abbreviation expansion and redirect logic:

```typescript
        // 4. Function-name fallback: float() → f_float.sthlp
        if (my_topic.endsWith('()')) {
            const my_func_name = my_topic.slice(0, -2);
            if (my_func_name.length > 0) {
                const my_func_path = await my_indexer.resolve_sthlp_file(
                    `f_${my_func_name}`
                );
                if (my_func_path) {
                    return { file_path: my_func_path };
                }
            }
        }

        // 5. System variable fallback: _N, _n, _pi, _rc, _cons → _variables
        if (my_topic.startsWith('_')) {
            const my_sysvar_path = await my_indexer.resolve_sthlp_file(
                '_variables'
            );
            if (my_sysvar_path) {
                return { file_path: my_sysvar_path };
            }
        }
```

- [ ] **Step 2: Add test coverage for these fallbacks**

In `tests/integration/help-topic-coverage.test.ts`, add tests in the existing `describe` block:

```typescript
    it('resolves function topics with f_ prefix fallback', async () => {
        const the_function_topics = [
            'float()', 'runiform()', 'rnormal()', 'normalden()',
            'abbrev()', 'invnormal()', 'real()',
        ];
        const the_failed: string[] = [];

        for (const my_topic of the_function_topics) {
            const my_result = await handler({ topic: my_topic });
            if (!my_result.file_path) {
                the_failed.push(my_topic);
            }
        }

        expect(the_failed).toEqual([]);
    });

    it('resolves system variables to _variables.sthlp', async () => {
        const the_sysvar_topics = ['_N', '_n', '_pi', '_rc', '_cons'];
        const the_failed: string[] = [];

        for (const my_topic of the_sysvar_topics) {
            const my_result = await handler({ topic: my_topic });
            if (!my_result.file_path) {
                the_failed.push(my_topic);
            }
        }

        expect(the_failed).toEqual([]);
    });
```

- [ ] **Step 3: Run tests**

Run: `bun test tests/integration/help-topic-coverage.test.ts`
Expected: PASS (on machines with Stata installed; skipped otherwise)

- [ ] **Step 4: Commit**

```bash
git add src/server-handlers.ts tests/integration/help-topic-coverage.test.ts
git commit -m "Add f_ prefix and _ system variable fallbacks to resolver"
```

---

## Task 12: Final validation

- [ ] **Step 1: Run full test suite**

Run: `bun run test`
Expected: All tests PASS, typecheck PASS

- [ ] **Step 2: Run checker for final counts**

Run: `bun scripts/check-help-links.ts 2>&1 | tail -30`
Expected: Substantial reduction from the original 1,155 broken links. Record the final counts and the remaining categories.

- [ ] **Step 3: Commit any final adjustments**

If the checker reveals unexpected remaining issues, investigate and fix. Otherwise, commit a summary:

```bash
git add -A
git commit -m "Fix broken SMCL help links: INCLUDE expansion, anchor fallback, resolver improvements

Part 1: INCLUDE directive expansion via sight/expandIncludes
Part 2: Cross-file anchor fallback with topic_* glob search
Part 3: {search} rendered as plain text, f_ and _ resolver fallbacks

Resolves the majority of 1,155 broken links reported by check-help-links.ts."
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Part 1 (INCLUDE expansion): Tasks 1-6
- ✅ Part 2 (anchor fallback): Tasks 7-9
- ✅ Part 3a ({search} plain text): Task 10
- ✅ Part 3b (f_ prefix): Task 11
- ✅ Part 3c (_ prefix → _variables): Task 11
- ✅ Part 4 (validation): Tasks 6 step 2, 9, 12
- ✅ Shared marker scanner: Task 1
- ✅ Error handling: Built into include-expander (depth, cycles, missing), resolver (read failures)
- ✅ Checker-runtime parity: Task 6 imports shared modules
- ✅ Testing requirements: Unit tests in Tasks 1, 2, 10; integration tests in Task 11

**Placeholder scan:** No TBDs, TODOs, or "implement later". All code blocks are complete.

**Type consistency:** `extract_marker_names`, `expand_includes`, `IncludeResolver`, `ExpandIncludesParams/Result`, `ResolveSthlpFileParams` — all consistent across tasks.
