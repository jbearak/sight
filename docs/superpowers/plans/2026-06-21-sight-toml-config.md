# sight.toml Project Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `.sight.json` with a shared `sight.toml` project-config layer used by the LSP now and by `sight check` later.

**Architecture:** Add a focused `src/config-file/` module for discovery, loading, public-schema mapping, and merge behavior. Wire the LSP to consume that shared module, and update watched-file handling so edits, creation, and deletion of `sight.toml` and stale `.sight.json` files refresh project config without restarting. Keep CLI-facing APIs in the config module even though `sight check` is not implemented in this plan.

**Tech Stack:** TypeScript, Bun, `vscode-languageserver`, `vscode-uri`, Bun test, fast-check, and an npm TOML parser dependency verified at implementation time.

---

## File Structure

- Create `src/config-file/types.ts`: shared result and warning types.
- Create `src/config-file/discovery.ts`: bounded upward discovery from one search root.
- Create `src/config-file/merge.ts`: deep merge with arrays replacing wholesale.
- Create `src/config-file/schema.ts`: public camelCase config normalization and mapping to `DeepPartial<StataLSPConfig>`.
- Create `src/config-file/toml-loader.ts`: TOML parsing and warning collection.
- Create `src/config-file/discovery-load.ts`: discover/load and explicit-load entry points.
- Create `src/config-file/index.ts`: public exports.
- Modify `src/utils/workspace-config.ts`: remove `.sight.json` reader as active implementation and re-export only the public mapping type/function needed by tests that have not moved yet.
- Modify `src/server-factory.ts`: store project config state, merge client then project, reload config on workspace/config-file changes, and refresh dynamic watchers.
- Modify `src/server-handlers.ts`: route config-file watched events before Stata-source filtering.
- Modify `client/src/extension.ts`: include workspace-local config files in static watched events for clients that do not use server dynamic registration.
- Modify `docs/configuration.md`: document `sight.toml`, project-over-client precedence, and `.sight.json` removal.
- Modify `package.json` and lockfile: add a TOML parser dependency.
- Modify or replace current `.sight.json`-specific config tests under `tests/property/`.
- Add `tests/unit/config-file/*.test.ts` for deterministic config-file behavior.
- Add or modify integration/property tests for LSP reload behavior.

---

### Task 1: Add TOML Dependency And Config-File Types

**Files:**
- Modify: `package.json`
- Modify: the Bun lockfile that already exists in this repo (`bun.lockb` or `bun.lock`)
- Create: `src/config-file/types.ts`
- Create: `src/config-file/index.ts`
- Test: `tests/unit/config-file/types.test.ts`

- [ ] **Step 1: Record the implementation base SHA**

Run:

```bash
git rev-parse HEAD > /tmp/sight-toml-base-sha
```

Expected: `/tmp/sight-toml-base-sha` contains the commit before any implementation commits for this plan. Use this later for the final review diff and external review request.

- [ ] **Step 2: Add the TOML parser dependency**

Run:

```bash
bun add smol-toml
```

Expected: `package.json` gains a dependency entry for `smol-toml`, and Bun updates the lockfile.

- [ ] **Step 3: Verify the parser import before writing production code**

Run:

```bash
bun -e 'const { parse } = await import("smol-toml"); const out = parse("a = 1"); console.log(out.a)'
```

Expected:

```text
1
```

If this command fails, stop before continuing: the parser dependency choice must be corrected before any production code imports it.

- [ ] **Step 4: Write the failing type/export smoke test**

Create `tests/unit/config-file/types.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import {
    PROJECT_CONFIG_FILE,
    STALE_JSON_CONFIG_FILE,
    MAX_DISCOVERY_DEPTH,
} from '../../../src/config-file';

describe('config-file public constants', () => {
    it('exports canonical project config constants', () => {
        expect(PROJECT_CONFIG_FILE).toBe('sight.toml');
        expect(STALE_JSON_CONFIG_FILE).toBe('.sight.json');
        expect(MAX_DISCOVERY_DEPTH).toBe(32);
    });
});
```

- [ ] **Step 5: Run the smoke test and verify it fails**

Run:

```bash
bun test tests/unit/config-file/types.test.ts
```

Expected: FAIL because `src/config-file` does not exist yet.

- [ ] **Step 6: Add config-file result types**

Create `src/config-file/types.ts`:

```typescript
import type { StataLSPConfig } from '../types';

export const PROJECT_CONFIG_FILE = 'sight.toml';
export const STALE_JSON_CONFIG_FILE = '.sight.json';
export const MAX_DISCOVERY_DEPTH = 32;

export type ProjectConfigWarningCode =
    | 'stale-json-config'
    | 'unknown-key'
    | 'invalid-value'
    | 'normalized-key-collision';

export interface ProjectConfigWarning {
    code: ProjectConfigWarningCode;
    message: string;
    path?: string;
    key_path?: string;
}

export type DeepPartial<T> = {
    [P in keyof T]?: T[P] extends Array<infer U>
        ? U[]
        : T[P] extends object
            ? DeepPartial<T[P]>
            : T[P];
};

export interface DiscoveryOptions {
    max_depth?: number;
}

export interface DiscoveredConfigBase {
    candidate_dirs: string[];
    stale_json_paths: string[];
    warnings: ProjectConfigWarning[];
}

export type DiscoveredConfig =
    | (DiscoveredConfigBase & {
        kind: 'sight-toml';
        path: string;
    })
    | (DiscoveredConfigBase & {
        kind: 'none';
    });

export type LoadedProjectConfig =
    | {
        kind: 'loaded';
        path: string;
        partial_config: DeepPartial<StataLSPConfig>;
        warnings: ProjectConfigWarning[];
        stale_json_paths: string[];
        candidate_dirs: string[];
    }
    | {
        kind: 'load-failed';
        path: string;
        error: string;
        warnings: ProjectConfigWarning[];
        stale_json_paths: string[];
        candidate_dirs: string[];
    }
    | {
        kind: 'none';
        warnings: ProjectConfigWarning[];
        stale_json_paths: string[];
        candidate_dirs: string[];
    };
```

Create `src/config-file/index.ts`:

```typescript
export * from './types';
```

- [ ] **Step 7: Run the smoke test and verify it passes**

Run:

```bash
bun test tests/unit/config-file/types.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add package.json src/config-file/types.ts src/config-file/index.ts tests/unit/config-file/types.test.ts
git add $(ls bun.lockb bun.lock 2>/dev/null)
git commit -m "Add project config file contracts"
```

---

### Task 2: Implement Discovery And Merge

**Files:**
- Create: `src/config-file/discovery.ts`
- Create: `src/config-file/merge.ts`
- Modify: `src/config-file/index.ts`
- Test: `tests/unit/config-file/discovery.test.ts`
- Test: `tests/unit/config-file/merge.test.ts`

- [ ] **Step 1: Write failing discovery tests**

Create `tests/unit/config-file/discovery.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    find_project_config,
    PROJECT_CONFIG_FILE,
    STALE_JSON_CONFIG_FILE,
} from '../../../src/config-file';

function make_temp_dir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'sight-config-'));
}

describe('find_project_config', () => {
    it('finds the nearest sight.toml from a single search root', () => {
        const root = make_temp_dir();
        const parent_config = path.join(root, PROJECT_CONFIG_FILE);
        const child = path.join(root, 'a', 'b');
        const child_config = path.join(root, 'a', PROJECT_CONFIG_FILE);
        fs.mkdirSync(child, { recursive: true });
        fs.writeFileSync(parent_config, 'debug = false\n');
        fs.writeFileSync(child_config, 'debug = true\n');

        const result = find_project_config(child, { max_depth: 2 });

        expect(result.kind).toBe('sight-toml');
        if (result.kind === 'sight-toml') {
            expect(result.path).toBe(child_config);
        }
        expect(result.candidate_dirs).toEqual([
            child,
            path.dirname(child),
        ]);
    });

    it('detects stale .sight.json without making it active', () => {
        const root = make_temp_dir();
        const child = path.join(root, 'project');
        const stale = path.join(root, STALE_JSON_CONFIG_FILE);
        fs.mkdirSync(child, { recursive: true });
        fs.writeFileSync(stale, '{"diagnostics":{"indentation":true}}\n');

        const result = find_project_config(child, { max_depth: 2 });

        expect(result.kind).toBe('none');
        expect(result.stale_json_paths).toEqual([stale]);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].code).toBe('stale-json-config');
    });

    it('stops at max depth', () => {
        const root = make_temp_dir();
        const child = path.join(root, 'a', 'b', 'c');
        fs.mkdirSync(child, { recursive: true });
        fs.writeFileSync(path.join(root, PROJECT_CONFIG_FILE), 'debug = true\n');

        const result = find_project_config(child, { max_depth: 2 });

        expect(result.kind).toBe('none');
        expect(result.candidate_dirs).toEqual([
            child,
            path.dirname(child),
        ]);
    });
});
```

- [ ] **Step 2: Write failing merge tests**

Create `tests/unit/config-file/merge.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { deep_merge_config } from '../../../src/config-file';

describe('deep_merge_config', () => {
    it('merges objects recursively with project values winning at leaves', () => {
        const client = {
            formatting: { lineWidth: 100, indentSize: 2 },
            diagnostics: { indentation: false },
        };
        const project = {
            formatting: { indentSize: 4 },
        };

        expect(deep_merge_config(client, project)).toEqual({
            formatting: { lineWidth: 100, indentSize: 4 },
            diagnostics: { indentation: false },
        });
    });

    it('replaces arrays wholesale', () => {
        const client = { adoPaths: ['/client'] };
        const project = { adoPaths: ['/project', '/shared'] };

        expect(deep_merge_config(client, project)).toEqual({
            adoPaths: ['/project', '/shared'],
        });
    });

    it('returns a clone when project config is absent', () => {
        const client = { debug: true };
        const merged = deep_merge_config(client, undefined);

        expect(merged).toEqual(client);
        expect(merged).not.toBe(client);
    });
});
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```bash
bun test tests/unit/config-file/discovery.test.ts tests/unit/config-file/merge.test.ts
```

Expected: FAIL because `find_project_config` and `deep_merge_config` are not implemented.

- [ ] **Step 4: Implement discovery**

Create `src/config-file/discovery.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import {
    DiscoveredConfig,
    DiscoveryOptions,
    MAX_DISCOVERY_DEPTH,
    PROJECT_CONFIG_FILE,
    ProjectConfigWarning,
    STALE_JSON_CONFIG_FILE,
} from './types';

function stale_json_warning(config_path: string): ProjectConfigWarning {
    return {
        code: 'stale-json-config',
        path: config_path,
        message:
            '.sight.json is no longer supported. Convert it to sight.toml; ' +
            'JSON syntax is not compatible with TOML.',
    };
}

export function ancestor_dirs(
    search_root: string,
    max_depth: number = MAX_DISCOVERY_DEPTH
): string[] {
    const dirs: string[] = [];
    let current = path.resolve(search_root);

    for (let i = 0; i < max_depth; i++) {
        dirs.push(current);
        const parent = path.dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }

    return dirs;
}

export function find_project_config(
    search_root: string,
    options: DiscoveryOptions = {}
): DiscoveredConfig {
    const candidate_dirs: string[] = [];
    const stale_json_paths: string[] = [];
    const warnings: ProjectConfigWarning[] = [];
    const max_depth = options.max_depth ?? MAX_DISCOVERY_DEPTH;

    for (const my_dir of ancestor_dirs(search_root, max_depth)) {
        candidate_dirs.push(my_dir);

        const stale_json_path = path.join(my_dir, STALE_JSON_CONFIG_FILE);
        if (fs.existsSync(stale_json_path)) {
            stale_json_paths.push(stale_json_path);
            warnings.push(stale_json_warning(stale_json_path));
        }

        const config_path = path.join(my_dir, PROJECT_CONFIG_FILE);
        if (fs.existsSync(config_path)) {
            return {
                kind: 'sight-toml',
                path: config_path,
                candidate_dirs,
                stale_json_paths,
                warnings,
            };
        }
    }

    return {
        kind: 'none',
        candidate_dirs,
        stale_json_paths,
        warnings,
    };
}
```

- [ ] **Step 5: Implement deep merge**

Create `src/config-file/merge.ts`:

```typescript
type JsonObject = Record<string, unknown>;

function is_plain_object(value: unknown): value is JsonObject {
    return typeof value === 'object'
        && value !== null
        && !Array.isArray(value);
}

export function deep_merge_config<T>(client: T, project: unknown): T {
    if (project === undefined || project === null) {
        return structuredClone(client);
    }
    if (Array.isArray(project)) {
        return structuredClone(project) as T;
    }
    if (!is_plain_object(project)) {
        return structuredClone(project) as T;
    }

    const result: JsonObject = is_plain_object(client)
        ? structuredClone(client)
        : {};

    for (const [key, value] of Object.entries(project)) {
        if (is_plain_object(result[key]) && is_plain_object(value)) {
            result[key] = deep_merge_config(result[key], value);
        } else {
            result[key] = structuredClone(value);
        }
    }

    return result as T;
}
```

Update `src/config-file/index.ts`:

```typescript
export * from './types';
export * from './discovery';
export * from './merge';
```

- [ ] **Step 6: Run tests and verify they pass**

Run:

```bash
bun test tests/unit/config-file/discovery.test.ts tests/unit/config-file/merge.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/config-file/discovery.ts src/config-file/merge.ts src/config-file/index.ts tests/unit/config-file/discovery.test.ts tests/unit/config-file/merge.test.ts
git commit -m "Add project config discovery and merge"
```

---

### Task 3: Implement Public Schema Mapping And TOML Loading

**Files:**
- Create: `src/config-file/schema.ts`
- Create: `src/config-file/toml-loader.ts`
- Create: `src/config-file/discovery-load.ts`
- Modify: `src/config-file/index.ts`
- Modify: `src/utils/workspace-config.ts`
- Test: `tests/unit/config-file/schema.test.ts`
- Test: `tests/unit/config-file/toml-loader.test.ts`
- Test: `tests/unit/config-file/discovery-load.test.ts`
- Modify: existing config mapping tests to import from `src/config-file`

- [ ] **Step 1: Write failing schema tests**

Create `tests/unit/config-file/schema.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { map_public_config_to_partial_config } from '../../../src/config-file';

describe('map_public_config_to_partial_config', () => {
    it('maps every public server-side section into internal config shape', () => {
        const result = map_public_config_to_partial_config({
            indexWorkspace: false,
            adoPaths: ['/ado'],
            lineCommentStyle: '*',
            debug: true,
            diagnostics: {
                enabled: false,
                indentation: true,
                severity: {
                    undefinedMacro: 'error',
                    undefinedVariable: 'warning',
                    styleWarnings: 'information',
                    malformedOperator: 'hint',
                    invalidOperatorSequence: 'off',
                    cStyleLogicalInControlFlow: 'info',
                    mixedLogicalOperators: 'warning',
                },
            },
            formatting: {
                indentSize: 2,
                indentStyle: 'tabs',
                lineWidth: 100,
                preferredCommentStyle: 'line',
                normalizeCommentStyle: true,
                commentLineWidth: 88,
                mode: 'ast',
                preserveAlignment: false,
            },
            completion: {
                cacheSize: 50,
                prefixMaxItems: 25,
            },
            indexing: {
                maxFileSizeBytes: 12345,
            },
            crossFile: {
                indexWorkspace: false,
                maxIndexedFiles: 17,
                assumeCallSite: 'start',
                backwardDependencies: 'explicit',
                maxBackwardDepth: 3,
                maxForwardDepth: 4,
                maxChainDepth: 5,
                maxCalleeRevalidations: 6,
                diagnostics: {
                    missingFile: 'error',
                    maxDepth: 'info',
                    callSiteIdentification: 'off',
                },
            },
        });

        expect(result.indexWorkspace).toBe(false);
        expect(result.adoPaths).toEqual(['/ado']);
        expect(result.lineCommentStyle).toBe('*');
        expect(result.debug).toBe(true);
        expect(result.diagnostics?.enabled).toBe(false);
        expect(result.diagnostics?.severity?.cStyleLogicalInControlFlow).toBe('information');
        expect(result.formatting?.preserve_alignment).toBe(false);
        expect(result.cross_file?.backward_dependencies).toBe('explicit');
        expect(result.cross_file?.diagnostics?.max_depth).toBe('information');
    });

    it('accepts known keys and enum values case-insensitively', () => {
        const result = map_public_config_to_partial_config({
            CrossFile: {
                BackwardDependencies: 'AUTO',
                Diagnostics: {
                    MissingFile: 'Info',
                },
            },
        });

        expect(result.cross_file?.backward_dependencies).toBe('auto');
        expect(result.cross_file?.diagnostics?.missing_file).toBe('information');
    });

    it('warns and ignores colliding aliases when no canonical spelling exists', () => {
        const warnings: string[] = [];
        const result = map_public_config_to_partial_config(
            {
                CrossFile: { maxChainDepth: 10 },
                crossfile: { maxChainDepth: 20 },
            },
            (warning) => warnings.push(warning.message)
        );

        expect(result.cross_file).toBeUndefined();
        expect(warnings.join('\n')).toContain('crossFile');
    });

    it('uses canonical spelling when aliases collide with canonical spelling', () => {
        const result = map_public_config_to_partial_config({
            crossFile: { maxChainDepth: 10 },
            CrossFile: { maxChainDepth: 20 },
        });

        expect(result.cross_file?.max_chain_depth).toBe(10);
    });
});
```

- [ ] **Step 2: Write failing TOML loader tests**

Create `tests/unit/config-file/toml-loader.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { load_toml_str } from '../../../src/config-file';

describe('load_toml_str', () => {
    it('parses sight.toml into a partial internal config', () => {
        const loaded = load_toml_str(
            `
debug = true

[crossFile]
maxChainDepth = 7
backwardDependencies = "AUTO"

[crossFile.diagnostics]
missingFile = "Info"
`,
            'test sight.toml'
        );

        expect(loaded.kind).toBe('loaded');
        if (loaded.kind === 'loaded') {
            expect(loaded.partial_config.debug).toBe(true);
            expect(loaded.partial_config.cross_file?.max_chain_depth).toBe(7);
            expect(loaded.partial_config.cross_file?.backward_dependencies).toBe('auto');
            expect(loaded.partial_config.cross_file?.diagnostics?.missing_file).toBe('information');
        }
    });

    it('returns load-failed for malformed TOML', () => {
        const loaded = load_toml_str('not = = toml', 'bad sight.toml');

        expect(loaded.kind).toBe('load-failed');
        if (loaded.kind === 'load-failed') {
            expect(loaded.error).toContain('bad sight.toml');
        }
    });
});
```

- [ ] **Step 3: Write failing discovery-load tests**

Create `tests/unit/config-file/discovery-load.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    discover_and_load_project_config,
    load_explicit_project_config_from_base,
} from '../../../src/config-file';

function make_temp_dir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'sight-load-'));
}

describe('discover_and_load_project_config', () => {
    it('loads the nearest sight.toml', () => {
        const root = make_temp_dir();
        const child = path.join(root, 'child');
        fs.mkdirSync(child);
        fs.writeFileSync(path.join(root, 'sight.toml'), 'debug = true\n');

        const loaded = discover_and_load_project_config(child);

        expect(loaded.kind).toBe('loaded');
        if (loaded.kind === 'loaded') {
            expect(loaded.partial_config.debug).toBe(true);
        }
    });

    it('does not fall through to ancestor when nearest sight.toml is malformed', () => {
        const root = make_temp_dir();
        const child = path.join(root, 'child');
        fs.mkdirSync(child);
        fs.writeFileSync(path.join(root, 'sight.toml'), 'debug = true\n');
        fs.writeFileSync(path.join(child, 'sight.toml'), 'bad = = toml\n');

        const loaded = discover_and_load_project_config(child);

        expect(loaded.kind).toBe('load-failed');
        if (loaded.kind === 'load-failed') {
            expect(loaded.path).toBe(path.join(child, 'sight.toml'));
        }
    });
});

describe('load_explicit_project_config_from_base', () => {
    it('resolves relative explicit config paths from caller supplied base', () => {
        const root = make_temp_dir();
        const config_dir = path.join(root, 'config');
        fs.mkdirSync(config_dir);
        fs.writeFileSync(path.join(config_dir, 'sight.toml'), 'debug = true\n');

        const loaded = load_explicit_project_config_from_base(
            root,
            path.join('config', 'sight.toml')
        );

        expect(loaded.kind).toBe('loaded');
        if (loaded.kind === 'loaded') {
            expect(loaded.path).toBe(path.join(config_dir, 'sight.toml'));
        }
    });
});
```

- [ ] **Step 4: Run tests and verify they fail**

Run:

```bash
bun test tests/unit/config-file/schema.test.ts tests/unit/config-file/toml-loader.test.ts tests/unit/config-file/discovery-load.test.ts
```

Expected: FAIL because schema, TOML loader, and discovery-load entry points do not exist yet.

- [ ] **Step 5: Implement schema mapping**

Create `src/config-file/schema.ts` with this structure:

```typescript
import type { StataLSPConfig } from '../types';
import type { DeepPartial, ProjectConfigWarning } from './types';

type WarningSink = (warning: ProjectConfigWarning) => void;
type JsonObject = Record<string, unknown>;

const SEVERITIES = new Set(['error', 'warning', 'information', 'hint', 'off', 'info']);
const CROSS_FILE_SEVERITIES = new Set(['error', 'warning', 'information', 'off', 'info']);

function is_object(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalize_name(value: string): string {
    return value.replace(/_/g, '').toLowerCase();
}

function warn_invalid_value(
    key_path: string,
    value: unknown,
    warn?: WarningSink
): void {
    warn?.({
        code: 'invalid-value',
        key_path,
        message: `Invalid value for '${key_path}': ${JSON.stringify(value)}; ignoring`,
    });
}

function normalize_severity(
    value: unknown,
    key_path: string,
    warn?: WarningSink
): 'error' | 'warning' | 'information' | 'hint' | 'off' | undefined {
    if (typeof value !== 'string') {
        warn_invalid_value(key_path, value, warn);
        return undefined;
    }
    const lower = value.toLowerCase();
    if (!SEVERITIES.has(lower)) {
        warn_invalid_value(key_path, value, warn);
        return undefined;
    }
    return (lower === 'info' ? 'information' : lower) as
        'error' | 'warning' | 'information' | 'hint' | 'off';
}

function normalize_cross_file_severity(
    value: unknown,
    key_path: string,
    warn?: WarningSink
): 'error' | 'warning' | 'information' | 'off' | undefined {
    if (typeof value !== 'string') {
        warn_invalid_value(key_path, value, warn);
        return undefined;
    }
    const lower = value.toLowerCase();
    if (!CROSS_FILE_SEVERITIES.has(lower)) {
        warn_invalid_value(key_path, value, warn);
        return undefined;
    }
    return (lower === 'info' ? 'information' : lower) as
        'error' | 'warning' | 'information' | 'off';
}

function pick_key(
    obj: JsonObject,
    canonical_key: string,
    warn?: WarningSink,
    parent_path = canonical_key
): unknown {
    const matches = Object.keys(obj).filter(
        (my_key) => normalize_name(my_key) === normalize_name(canonical_key)
    );
    if (matches.length === 0) {
        return undefined;
    }
    const canonical_matches = matches.filter((my_key) => my_key === canonical_key);
    if (canonical_matches.length === 1) {
        if (matches.length > 1) {
            warn?.({
                code: 'normalized-key-collision',
                key_path: parent_path,
                message:
                    `Multiple keys normalize to '${parent_path}'; ` +
                    `using canonical spelling '${canonical_key}' and ignoring ` +
                    matches.filter((my_key) => my_key !== canonical_key).join(', '),
            });
        }
        return obj[canonical_key];
    }
    if (matches.length > 1) {
        warn?.({
            code: 'normalized-key-collision',
            key_path: parent_path,
            message:
                `Multiple keys normalize to '${parent_path}' and none use ` +
                `canonical spelling; ignoring ${matches.join(', ')}`,
        });
        return undefined;
    }
    return obj[matches[0]];
}

function set_if_boolean<T extends JsonObject>(
    target: T,
    key: keyof T,
    source: JsonObject,
    public_key: string,
    warn?: WarningSink
): void {
    const value = pick_key(source, public_key, warn, public_key);
    if (typeof value === 'boolean') {
        target[key] = value as T[keyof T];
    }
}

function set_if_number<T extends JsonObject>(
    target: T,
    key: keyof T,
    source: JsonObject,
    public_key: string,
    warn?: WarningSink
): void {
    const value = pick_key(source, public_key, warn, public_key);
    if (typeof value === 'number') {
        target[key] = value as T[keyof T];
    }
}

function set_if_string_member<T extends JsonObject, V extends string>(
    target: T,
    key: keyof T,
    source: JsonObject,
    public_key: string,
    allowed: readonly V[],
    warn?: WarningSink
): void {
    const value = pick_key(source, public_key, warn, public_key);
    if (typeof value !== 'string') {
        if (value !== undefined) {
            warn_invalid_value(public_key, value, warn);
        }
        return;
    }
    const match = allowed.find(
        (candidate) => candidate.toLowerCase() === value.toLowerCase()
    );
    if (match) {
        target[key] = match as T[keyof T];
    } else {
        warn_invalid_value(public_key, value, warn);
    }
}
```

Then add `map_public_config_to_partial_config(raw, warn?)` in the same file. The function starts as:

```typescript
export function map_public_config_to_partial_config(
    raw: unknown,
    warn?: WarningSink
): DeepPartial<StataLSPConfig> {
    if (!is_object(raw)) {
        return {};
    }

    const mapped: DeepPartial<StataLSPConfig> = {};

    const index_workspace = pick_key(raw, 'indexWorkspace', warn, 'indexWorkspace');
    if (typeof index_workspace === 'boolean') {
        mapped.indexWorkspace = index_workspace;
    }

    const ado_paths = pick_key(raw, 'adoPaths', warn, 'adoPaths');
    if (Array.isArray(ado_paths) && ado_paths.every((item) => typeof item === 'string')) {
        mapped.adoPaths = ado_paths;
    }

    const line_comment_style = pick_key(raw, 'lineCommentStyle', warn, 'lineCommentStyle');
    if (line_comment_style === '//' || line_comment_style === '*') {
        mapped.lineCommentStyle = line_comment_style;
    }

    const debug = pick_key(raw, 'debug', warn, 'debug');
    if (typeof debug === 'boolean') {
        mapped.debug = debug;
    }

    // Add the explicit mappings listed below in this same function.

    return mapped;
}
```

Add these explicit mappings in `map_public_config_to_partial_config`; do not use dynamic string transforms for internal config names because explicit mapping keeps accidental client-only keys out of `sight.toml`.

```typescript
// diagnostics
// diagnostics.enabled -> mapped.diagnostics.enabled
// diagnostics.indentation -> mapped.diagnostics.indentation
// diagnostics.severity.undefinedMacro -> mapped.diagnostics.severity.undefinedMacro
// diagnostics.severity.undefinedVariable -> mapped.diagnostics.severity.undefinedVariable
// diagnostics.severity.styleWarnings -> mapped.diagnostics.severity.styleWarnings
// diagnostics.severity.malformedOperator -> mapped.diagnostics.severity.malformedOperator
// diagnostics.severity.invalidOperatorSequence -> mapped.diagnostics.severity.invalidOperatorSequence
// diagnostics.severity.cStyleLogicalInControlFlow -> mapped.diagnostics.severity.cStyleLogicalInControlFlow
// diagnostics.severity.mixedLogicalOperators -> mapped.diagnostics.severity.mixedLogicalOperators

// formatting
// formatting.indentSize -> mapped.formatting.indentSize
// formatting.indentStyle -> mapped.formatting.indentStyle
// formatting.lineWidth -> mapped.formatting.lineWidth
// formatting.preferredCommentStyle -> mapped.formatting.preferredCommentStyle
// formatting.normalizeCommentStyle -> mapped.formatting.normalizeCommentStyle
// formatting.commentLineWidth -> mapped.formatting.commentLineWidth
// formatting.mode -> mapped.formatting.mode
// formatting.preserveAlignment -> mapped.formatting.preserve_alignment

// completion
// completion.cacheSize -> mapped.completion.cacheSize
// completion.prefixMaxItems -> mapped.completion.prefixMaxItems

// indexing
// indexing.maxFileSizeBytes -> mapped.indexing.maxFileSizeBytes

// crossFile
// crossFile.indexWorkspace -> mapped.cross_file.index_workspace
// crossFile.maxIndexedFiles -> mapped.cross_file.max_indexed_files
// crossFile.assumeCallSite -> mapped.cross_file.assume_call_site
// crossFile.backwardDependencies -> mapped.cross_file.backward_dependencies
// crossFile.maxBackwardDepth -> mapped.cross_file.max_backward_depth
// crossFile.maxForwardDepth -> mapped.cross_file.max_forward_depth
// crossFile.maxChainDepth -> mapped.cross_file.max_chain_depth
// crossFile.maxCalleeRevalidations -> mapped.cross_file.max_callee_revalidations
// crossFile.diagnostics.missingFile -> mapped.cross_file.diagnostics.missing_file
// crossFile.diagnostics.maxDepth -> mapped.cross_file.diagnostics.max_depth
// crossFile.diagnostics.callSiteIdentification -> mapped.cross_file.diagnostics.call_site_identification
```

Use these canonical enum values:

```typescript
const INDENT_STYLES = ['spaces', 'tabs'] as const;
const FORMATTER_MODES = ['source-preserving', 'ast'] as const;
const COMMENT_STYLES = ['line', '//', '*', '/* */'] as const;
const LINE_COMMENT_STYLES = ['//', '*'] as const;
const ASSUME_CALL_SITE_VALUES = ['start', 'end'] as const;
const BACKWARD_DEPENDENCY_VALUES = ['auto', 'explicit'] as const;
```

For every enum-like string value, compare case-insensitively and store the canonical value. All `diagnostics.severity.*` leaves must use `normalize_severity`, and all `crossFile.diagnostics.*` leaves must use `normalize_cross_file_severity`; this is what maps `info` to `information`. Only non-severity enums should use `set_if_string_member`. For numeric and boolean fields, accept only actual TOML numbers and booleans; warn and omit wrong-typed leaves. The `SEVERITIES` and `CROSS_FILE_SEVERITIES` sets must be used by the severity mapping code; do not leave them as dead constants.

- [ ] **Step 6: Implement TOML loader and discovery-load**

Create `src/config-file/toml-loader.ts`:

```typescript
import * as fs from 'fs';
import { parse } from 'smol-toml';
import type { LoadedProjectConfig, ProjectConfigWarning } from './types';
import { map_public_config_to_partial_config } from './schema';

export function load_toml_str(
    text: string,
    source_label: string
): LoadedProjectConfig {
    const warnings: ProjectConfigWarning[] = [];
    try {
        const parsed = parse(text);
        const partial_config = map_public_config_to_partial_config(
            parsed,
            (warning) => warnings.push({ ...warning, path: source_label })
        );
        return {
            kind: 'loaded',
            path: source_label,
            partial_config,
            warnings,
            stale_json_paths: [],
            candidate_dirs: [],
        };
    } catch (error) {
        return {
            kind: 'load-failed',
            path: source_label,
            error: `${source_label}: ${error instanceof Error ? error.message : String(error)}`,
            warnings,
            stale_json_paths: [],
            candidate_dirs: [],
        };
    }
}

export function load_toml_file(path: string): LoadedProjectConfig {
    try {
        return load_toml_str(fs.readFileSync(path, 'utf8'), path);
    } catch (error) {
        return {
            kind: 'load-failed',
            path,
            error: `${path}: ${error instanceof Error ? error.message : String(error)}`,
            warnings: [],
            stale_json_paths: [],
            candidate_dirs: [],
        };
    }
}
```

Create `src/config-file/discovery-load.ts`:

```typescript
import * as path from 'path';
import { find_project_config } from './discovery';
import { load_toml_file } from './toml-loader';
import type { DiscoveryOptions, LoadedProjectConfig } from './types';

function with_discovery_metadata(
    loaded: LoadedProjectConfig,
    candidate_dirs: string[],
    stale_json_paths: string[],
    warnings: LoadedProjectConfig['warnings']
): LoadedProjectConfig {
    return {
        ...loaded,
        candidate_dirs,
        stale_json_paths,
        warnings: [...warnings, ...loaded.warnings],
    } as LoadedProjectConfig;
}

export function resolve_explicit_config_path(base_dir: string, explicit_path: string): string {
    return path.resolve(base_dir, explicit_path);
}

export function load_explicit_project_config(path_to_config: string): LoadedProjectConfig {
    return load_toml_file(path_to_config);
}

export function load_explicit_project_config_from_base(
    base_dir: string,
    explicit_path: string
): LoadedProjectConfig {
    return load_explicit_project_config(
        resolve_explicit_config_path(base_dir, explicit_path)
    );
}

export function discover_and_load_project_config(
    search_root: string,
    options: DiscoveryOptions = {}
): LoadedProjectConfig {
    const discovered = find_project_config(search_root, options);
    if (discovered.kind === 'none') {
        return {
            kind: 'none',
            warnings: discovered.warnings,
            stale_json_paths: discovered.stale_json_paths,
            candidate_dirs: discovered.candidate_dirs,
        };
    }

    return with_discovery_metadata(
        load_toml_file(discovered.path),
        discovered.candidate_dirs,
        discovered.stale_json_paths,
        discovered.warnings
    );
}
```

Update `src/config-file/index.ts`:

```typescript
export * from './types';
export * from './discovery';
export * from './merge';
export * from './schema';
export * from './toml-loader';
export * from './discovery-load';
```

- [ ] **Step 7: Preserve old mapper imports while migrating tests**

Before editing `src/utils/workspace-config.ts`, enumerate every live consumer of the old JSON reader:

```bash
rg -n "read_workspace_file_config_from_root|workspace_file_config" src tests
```

Expected current consumers are in `src/server-factory.ts` and `src/utils/workspace-config.ts`. If additional consumers appear, update this task list before deleting the reader so no active `.sight.json` loading path survives by accident.

Modify `src/utils/workspace-config.ts` so active code no longer reads `.sight.json`, but existing imports can move gradually:

```typescript
import type { StataLSPConfig } from '../types';
import type { DeepPartial } from '../config-file';

export {
    type DeepPartial,
    map_public_config_to_partial_config as map_stata_lsp_json_to_partial_config,
} from '../config-file';

export function read_workspace_file_config_from_root(
    _workspace_root: string
): { partial_config: DeepPartial<StataLSPConfig>; error?: string } {
    return { partial_config: {} };
}
```

This temporary compatibility stub exists only to keep Task 3 typechecking before Task 4 rewires the server. It must not read `.sight.json`, parse JSON, or emit active config. Task 4 removes the remaining server-factory state/imports that referenced it.

- [ ] **Step 8: Run focused tests**

Run:

```bash
bun test tests/unit/config-file/schema.test.ts tests/unit/config-file/toml-loader.test.ts tests/unit/config-file/discovery-load.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 9: Run old config mapping tests and update imports/assertions**

Run:

```bash
bun test tests/property/config-mapping-type-safety.prop.test.ts tests/property/rename-validation.prop.test.ts tests/property/rename-validation-comprehensive.prop.test.ts
```

Expected on first run: failures mentioning `.sight.json` naming or mapper import assumptions.

Update those tests to:

```typescript
import { map_public_config_to_partial_config } from '../../src/config-file';
```

Replace assertions that config filenames must be `.sight.json` with `sight.toml` and stale `.sight.json` warning behavior.

Run the same command again.

Expected: PASS.

- [ ] **Step 10: Commit**

Run:

```bash
git add src/config-file src/utils/workspace-config.ts tests/unit/config-file tests/property/config-mapping-type-safety.prop.test.ts tests/property/rename-validation.prop.test.ts tests/property/rename-validation-comprehensive.prop.test.ts
git commit -m "Load sight.toml project config"
```

---

### Task 4: Wire Project Config Into Server Settings

**Files:**
- Modify: `src/server-factory.ts`
- Test: `tests/integration/sight-toml-config.test.ts`
- Test: `tests/unit/server-project-config-wiring.test.ts`
- Test: existing handler/config tests that fail from precedence changes

- [ ] **Step 1: Write failing config semantics tests**

Create `tests/integration/sight-toml-config.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    deep_merge_config,
    discover_and_load_project_config,
} from '../../src/config-file';
import { validate_comment_formatting_config } from '../../src/utils/config-validator';

function make_temp_dir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'sight-lsp-config-'));
}

describe('sight.toml server config precedence', () => {
    it('project config overrides client config while silent client keys survive', () => {
        const client = {
            formatting: {
                lineWidth: 100,
                indentSize: 2,
            },
        };
        const project = {
            formatting: {
                indentSize: 4,
            },
        };

        const settings = validate_comment_formatting_config(
            deep_merge_config(client, project)
        );

        expect(settings.formatting.lineWidth).toBe(100);
        expect(settings.formatting.indentSize).toBe(4);
    });

    it('malformed nearest sight.toml yields no project layer', () => {
        const root = make_temp_dir();
        fs.writeFileSync(path.join(root, 'sight.toml'), 'bad = = toml\n');

        const loaded = discover_and_load_project_config(root);

        expect(loaded.kind).toBe('load-failed');
    });

    it('deleting sight.toml removes the project layer on rediscovery', () => {
        const root = make_temp_dir();
        const config_path = path.join(root, 'sight.toml');
        fs.writeFileSync(config_path, 'debug = true\n');

        expect(discover_and_load_project_config(root).kind).toBe('loaded');
        fs.unlinkSync(config_path);

        const loaded = discover_and_load_project_config(root, { max_depth: 1 });

        expect(loaded.kind).toBe('none');
    });
});
```

`validate_comment_formatting_config` is the current server-side full-config normalizer despite its narrow name: it starts from `DEFAULT_SETTINGS`, validates known sections, and returns a complete `StataLSPConfig`. Use this existing function here and in `src/server-factory.ts`; do not introduce a second normalizer in this plan.

- [ ] **Step 2: Write failing server wiring test**

Create `tests/unit/server-project-config-wiring.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

describe('server-factory project config wiring', () => {
    const server_factory_path = path.join(
        __dirname,
        '../../src/server-factory.ts'
    );

    it('loads project config through the shared config-file module', () => {
        const source = fs.readFileSync(server_factory_path, 'utf8');

        expect(source).toContain('discover_and_load_project_config');
        expect(source).toContain('apply_loaded_project_config');
    });

    it('merges client settings before project settings', () => {
        const source = fs.readFileSync(server_factory_path, 'utf8');

        expect(source).toMatch(
            /const\s+client_partial\s*=\s*deep_merge_config\(\s*init_partial\s*\|\|\s*\{\},\s*config\s*\|\|\s*\{\}\s*\)/
        );
        expect(source).toMatch(
            /const\s+merged_partial\s*=\s*deep_merge_config\(\s*client_partial,\s*project_file_config\s*\|\|\s*\{\}\s*\)/
        );
    });
});
```

- [ ] **Step 3: Run tests and verify current behavior fails where expected**

Run:

```bash
bun test tests/integration/sight-toml-config.test.ts tests/unit/server-project-config-wiring.test.ts
```

Expected: `sight-toml-config.test.ts` passes if Task 3 APIs work; `server-project-config-wiring.test.ts` fails until `server-factory.ts` uses the shared project-config module and project-over-client merge order.

- [ ] **Step 4: Replace `.sight.json` state with project config state**

In `src/server-factory.ts`, replace:

```typescript
let workspace_file_config: DeepPartial<StataLSPConfig> | undefined = undefined;
```

with:

```typescript
let project_file_config: DeepPartial<StataLSPConfig> | undefined = undefined;
let project_config_path: string | undefined = undefined;
let project_config_candidate_dirs: string[] = [];
let active_workspace_roots: string[] = [];
```

Update imports:

```typescript
import type { DeepPartial } from './config-file';
import {
    deep_merge_config,
    discover_and_load_project_config,
    type LoadedProjectConfig,
} from './config-file';
import { validate_comment_formatting_config } from './utils/config-validator';
```

Remove imports of `read_workspace_file_config_from_root` and `map_stata_lsp_json_to_partial_config` from `src/utils/workspace-config`.

After `src/server-factory.ts` no longer imports `read_workspace_file_config_from_root`, delete the temporary no-op compatibility stub from `src/utils/workspace-config.ts`. Leave only the mapper/type re-export if old property tests still need it; otherwise remove `src/utils/workspace-config.ts` entirely when no imports remain.

- [ ] **Step 5: Add a helper to apply loaded project config**

In `src/server-factory.ts`, near `deep_merge`, add:

```typescript
function log_project_config_warnings(loaded: LoadedProjectConfig): void {
    for (const my_warning of loaded.warnings) {
        connection.console.log(`Project config warning: ${my_warning.message}`);
    }
    if (loaded.kind === 'load-failed') {
        connection.console.log(`Project config warning: ${loaded.error}`);
    }
}

function apply_loaded_project_config(loaded: LoadedProjectConfig): void {
    log_project_config_warnings(loaded);
    project_config_candidate_dirs = loaded.candidate_dirs;
    if (loaded.kind === 'loaded') {
        project_file_config = loaded.partial_config;
        project_config_path = loaded.path;
    } else {
        project_file_config = undefined;
        project_config_path = undefined;
    }
}
```

- [ ] **Step 6: Change settings merge order**

In `get_document_settings`, replace the existing merge:

```typescript
const merged_partial = deep_merge(
    deep_merge(
        deep_merge({}, workspace_file_config || {}),
        init_partial || {}
    ),
    config || {}
);
```

with:

```typescript
const client_partial = deep_merge_config(init_partial || {}, config || {});
const merged_partial = deep_merge_config(
    client_partial,
    project_file_config || {}
);
```

In `onDidChangeConfiguration` for clients without configuration capability, replace the old merge with:

```typescript
const client_partial = deep_merge_config(
    init_partial || {},
    change_settings?.['sight'] || {}
);
const merged_partial = deep_merge_config(
    client_partial,
    project_file_config || {}
);
```

After both call sites use `deep_merge_config`, delete the local
`deep_merge` helper from `src/server-factory.ts` if no remaining code in that
file references it.

- [ ] **Step 7: Load project config during workspace refresh**

In `refresh_workspace_state`, replace the `.sight.json` load block with:

```typescript
if (folder_paths.length > 0) {
    active_workspace_roots = [...folder_paths];
    document_store.set_workspace_roots(folder_paths);
    if (scope_resolver) {
        scope_resolver.set_workspace_roots(folder_paths);
    }
    if (forward_scope_resolver) {
        forward_scope_resolver.set_workspace_roots(folder_paths);
    }

    apply_loaded_project_config(
        discover_and_load_project_config(folder_paths[0])
    );
} else {
    active_workspace_roots = [];
    document_store.set_workspace_roots([]);
    project_file_config = undefined;
    project_config_path = undefined;
    project_config_candidate_dirs = [];
    if (scope_resolver) {
        scope_resolver.set_workspace_roots([]);
    }
    if (forward_scope_resolver) {
        forward_scope_resolver.set_workspace_roots([]);
    }
}
```

- [ ] **Step 8: Run focused server tests**

Run:

```bash
bun test tests/integration/sight-toml-config.test.ts tests/unit/server-project-config-wiring.test.ts tests/property/handler-deps-mutation.prop.test.ts
```

Expected: PASS.

- [ ] **Step 9: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit**

Run:

```bash
git add src/server-factory.ts tests/integration/sight-toml-config.test.ts tests/unit/server-project-config-wiring.test.ts
git commit -m "Apply sight.toml settings in LSP"
```

---

### Task 5: Add Project Config Watched-File Reload

**Files:**
- Modify: `src/server-handlers.ts`
- Modify: `src/server-factory.ts`
- Modify: `client/src/extension.ts`
- Test: `tests/unit/config-file/project-config-events.test.ts`
- Test: `tests/unit/server-handlers-project-config-events.test.ts`
- Test: relevant handler tests

- [ ] **Step 1: Write failing event classification tests**

Create `tests/unit/config-file/project-config-events.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import * as path from 'path';
import {
    is_project_config_event_path,
    PROJECT_CONFIG_FILE,
    STALE_JSON_CONFIG_FILE,
} from '../../../src/config-file';

describe('is_project_config_event_path', () => {
    it('matches sight.toml and stale .sight.json exactly by basename', () => {
        expect(is_project_config_event_path(path.join('a', PROJECT_CONFIG_FILE))).toBe(true);
        expect(is_project_config_event_path(path.join('a', STALE_JSON_CONFIG_FILE))).toBe(true);
    });

    it('rejects similarly named files', () => {
        expect(is_project_config_event_path('sight.toml.bak')).toBe(false);
        expect(is_project_config_event_path('.sight.json.bak')).toBe(false);
        expect(is_project_config_event_path('SIGHT.TOML')).toBe(false);
    });
});
```

- [ ] **Step 2: Implement config event path helper**

Add to `src/config-file/discovery.ts`:

```typescript
export function is_project_config_event_path(file_path: string): boolean {
    const base = path.basename(file_path);
    return base === PROJECT_CONFIG_FILE || base === STALE_JSON_CONFIG_FILE;
}
```

Run:

```bash
bun test tests/unit/config-file/project-config-events.test.ts
```

Expected: PASS.

- [ ] **Step 3: Write failing watched-files handler routing test**

Create `tests/unit/server-handlers-project-config-events.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { FileChangeType } from 'vscode-languageserver/node';
import {
    create_did_change_watched_files_handler,
    DEFAULT_SETTINGS,
    type HandlerDependencies,
} from '../../src/server-handlers';
import { DocumentStore } from '../../src/document-store';

function create_null_deps(): HandlerDependencies {
    return {
        debounce_manager: null,
        document_store: new DocumentStore(),
        diagnostics_provider: null,
        completion_provider: null,
        hover_provider: null,
        definition_provider: null,
        references_provider: null,
        symbol_provider: null,
        formatter_provider: null,
        workspace_indexer: null,
        scope_resolver: null,
        forward_scope_resolver: null,
        dependency_graph: null,
        rename_handler: null,
        get_document_settings: async () => DEFAULT_SETTINGS,
        connection: {
            sendDiagnostics: () => {},
            console: { log: () => {} },
        },
    };
}

describe('watched-files project config routing', () => {
    it('routes sight.toml and .sight.json to project config reload only', () => {
        const deps = create_null_deps();
        const stata_changes: string[] = [];
        const config_changes: string[] = [];
        const handler = create_did_change_watched_files_handler(
            deps,
            (uri) => uri.replace('file://', ''),
            (uri) => stata_changes.push(uri),
            (uri) => config_changes.push(uri)
        );

        handler({
            changes: [
                { uri: 'file:///tmp/sight.toml', type: FileChangeType.Changed },
                { uri: 'file:///tmp/.sight.json', type: FileChangeType.Deleted },
                { uri: 'file:///tmp/main.do', type: FileChangeType.Changed },
            ],
        });

        expect(config_changes).toEqual([
            'file:///tmp/sight.toml',
            'file:///tmp/.sight.json',
        ]);
        expect(stata_changes).toEqual(['file:///tmp/main.do']);
    });
});
```

Expected: FAIL until `create_did_change_watched_files_handler` accepts and calls the config callback.

- [ ] **Step 4: Route config events before Stata filtering**

Modify `create_did_change_watched_files_handler` in `src/server-handlers.ts` to accept a fourth callback:

```typescript
export function create_did_change_watched_files_handler(
    deps: HandlerDependencies,
    parse_uri: (uri: string) => string,
    on_file_changed?: (uri: string) => void,
    on_project_config_changed?: (uri: string) => void
): (params: DidChangeWatchedFilesParams) => void {
```

At the start of the event loop, before the Stata extension filter, add:

```typescript
const file_path = parse_uri(my_event.uri);
if (is_project_config_event_path(file_path)) {
    on_project_config_changed?.(my_event.uri);
    continue;
}
```

Import `is_project_config_event_path` from `./config-file` at the top of `src/server-handlers.ts`. Ensure `file_path` is computed at the top of each event-loop iteration before both the config check and the Stata extension filter.

Do not call the workspace indexer for config files.

- [ ] **Step 5: Add project config reload helper in server factory**

In `src/server-factory.ts`, add:

```typescript
async function reload_project_config_from_active_root(): Promise<void> {
    const active_root = active_workspace_roots[0];
    if (!active_root) {
        return;
    }

    apply_loaded_project_config(
        discover_and_load_project_config(active_root)
    );
    document_settings.clear();

    const settings = await get_document_settings('');
    if (!server_capabilities.has_configuration_capability) {
        global_settings = settings;
    }

    if (workspace_indexer) {
        workspace_indexer.configure(settings);
        workspace_indexer.set_max_indexed_files(
            settings.cross_file?.max_indexed_files ?? 1000
        );
    }

    for (const my_doc of documents.all()) {
        diagnostics_provider?.clear_published_version(my_doc.uri);
        void validate_text_document(my_doc, 0);
    }
}
```

This deletion path matters: when `sight.toml` is deleted, `discover_and_load_project_config(active_root)` must return `kind: 'none'`, `apply_loaded_project_config` must clear `project_file_config`, and `document_settings.clear()` must force client-only settings to take effect again.

- [ ] **Step 6: Pass config reload callback to watched-file handler**

In `src/server-factory.ts`, change the watched-files registration to:

```typescript
connection.onDidChangeWatchedFiles(
    create_did_change_watched_files_handler(
        handler_deps,
        (uri: string) => URI.parse(uri).fsPath,
        async (uri: string) => {
            if (scope_resolver) {
                const callers = scope_resolver.get_callers_for_callee(uri);
                if (callers.size > 0) {
                    const settings = await get_document_settings(uri);
                    schedule_caller_revalidation(callers, uri, settings);
                }
            }
        },
        async () => {
            await reload_project_config_from_active_root();
        }
    )
);
```

- [ ] **Step 7: Add/refresh watched-file registrations**

In `client/src/extension.ts`, replace:

```typescript
const file_watcher = workspace.createFileSystemWatcher('**/*.{do,ado}');
```

with:

```typescript
const file_watcher = workspace.createFileSystemWatcher(
    '**/{*.do,*.ado,*.doh,*.mata,sight.toml,.sight.json}'
);
```

Then add server-side dynamic registration only if the client supports it. In `src/server-handlers.ts`, extend `ServerCapabilities`:

```typescript
has_watched_files_dynamic_registration_capability: boolean;
```

In `create_initialize_handler`, set it from:

```typescript
const has_watched_files_dynamic_registration_capability = !!(
    capabilities.workspace &&
    capabilities.workspace.didChangeWatchedFiles &&
    capabilities.workspace.didChangeWatchedFiles.dynamicRegistration
);
```

In `src/server-factory.ts`, initialize the capability to `false`. Import these names from `vscode-languageserver/node`:

```typescript
import {
    DidChangeWatchedFilesNotification,
    WatchKind,
    type Disposable,
    type FileSystemWatcher,
} from 'vscode-languageserver/node';
import { URI } from 'vscode-uri';
import * as path from 'path';
```

Add this state:

```typescript
let project_config_watch_registration: Disposable | undefined = undefined;
```

Add this helper:

```typescript
function project_config_watch_dirs(): string[] {
    const dirs = new Set<string>();
    for (const my_root of active_workspace_roots) {
        dirs.add(my_root);
    }
    if (project_config_path) {
        dirs.add(path.dirname(project_config_path));
    }
    return [...dirs];
}

function project_config_watchers_for_dirs(dirs: string[]): FileSystemWatcher[] {
    const watchers: FileSystemWatcher[] = [];
    for (const my_dir of dirs) {
        const baseUri = URI.file(my_dir).toString();
        watchers.push({
            globPattern: { baseUri, pattern: 'sight.toml' },
            kind: WatchKind.Create | WatchKind.Change | WatchKind.Delete,
        });
        watchers.push({
            globPattern: { baseUri, pattern: '.sight.json' },
            kind: WatchKind.Create | WatchKind.Change | WatchKind.Delete,
        });
    }
    return watchers;
}

async function refresh_project_config_watchers(): Promise<void> {
    if (!server_capabilities.has_watched_files_dynamic_registration_capability) {
        return;
    }
    project_config_watch_registration?.dispose();
    const watchers = project_config_watchers_for_dirs(project_config_watch_dirs());
    if (watchers.length === 0) {
        project_config_watch_registration = undefined;
        return;
    }
    project_config_watch_registration = await connection.client.register(
        DidChangeWatchedFilesNotification.type,
        { watchers }
    );
}
```

Call `await refresh_project_config_watchers()` after `apply_loaded_project_config(...)` in `refresh_workspace_state` and in `reload_project_config_from_active_root`.

Accepted limitation: the static client watcher in `client/src/extension.ts` only sees config files inside the workspace. If a user places `sight.toml` in an ancestor above the workspace root and the client does not support dynamic watched-file registration, editing that ancestor config may require restarting or changing a workspace file to refresh. Dynamic registration covers the discovered config directory plus workspace roots without registering the entire upward candidate chain.

- [ ] **Step 8: Run focused tests**

Run:

```bash
bun test tests/unit/config-file/project-config-events.test.ts tests/unit/server-handlers-project-config-events.test.ts tests/property/handler-deps-mutation.prop.test.ts
```

Expected: PASS.

- [ ] **Step 9: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit**

Run:

```bash
git add src/server-handlers.ts src/server-factory.ts client/src/extension.ts tests/unit/config-file/project-config-events.test.ts tests/unit/server-handlers-project-config-events.test.ts
git commit -m "Reload project config from watched files"
```

---

### Task 6: Remove `.sight.json` Documentation And Update User Docs

**Files:**
- Modify: `docs/configuration.md`
- Modify: `README.md` if it references `.sight.json`
- Modify: `tests/property/rename-validation-coverage.md` and related coverage docs if still present
- Test: documentation grep checks

- [ ] **Step 1: Locate stale documentation**

Run:

```bash
rg -n "\\.sight\\.json|sight\\.toml|Project Configuration File|VS Code settings take precedence" README.md docs tests client src
```

Expected: output includes `docs/configuration.md` and old test coverage docs.

- [ ] **Step 2: Update `docs/configuration.md` project config section**

Replace the `.sight.json` project config section with a `sight.toml` section that includes:

```markdown
## Project Configuration File

Sight reads `sight.toml` as the portable project configuration file. The LSP
discovers it by walking upward from the active workspace root; `sight check`
will use the same discovery from `--workspace`.

Project config wins over client/editor settings per key. Keys omitted from
`sight.toml` continue to come from editor settings or built-in defaults.

`.sight.json` is no longer supported. Convert its contents to TOML syntax;
renaming the file is not enough because JSON and TOML are different languages.
```

Include the canonical TOML example from the design spec. Explain both `indexWorkspace` switches:

```markdown
Both `indexWorkspace` and `crossFile.indexWorkspace` default to `true`.
Workspace indexing runs only when both are enabled; setting either to `false`
disables it.
```

- [ ] **Step 3: Update stale test coverage docs**

For markdown files under `tests/property/` that mention `.sight.json`, replace the config-file expectation with:

```markdown
Project config is `sight.toml`. `.sight.json` is only detected to warn users
that JSON project config is unsupported.
```

- [ ] **Step 4: Run documentation grep**

Run:

```bash
rg -n "\\.sight\\.json" README.md docs tests/property
```

Expected: only intentional migration/warning references remain.

- [ ] **Step 5: Run docs-related tests if present**

Run:

```bash
bun test tests/property/rename-validation.prop.test.ts tests/property/rename-validation-comprehensive.prop.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add docs README.md tests/property
git commit -m "Document sight.toml project config"
```

---

### Task 7: Full Verification And Review

**Files:**
- No planned source edits unless verification finds failures.

- [ ] **Step 1: Run full test command**

Run:

```bash
bun run test
```

Expected: PASS. This runs typecheck and `bun test ./tests`.

- [ ] **Step 2: Run focused config grep**

Run:

```bash
rg -n "read_workspace_file_config_from_root|\\.sight\\.json config|workspace_file_config|map_stata_lsp_json_to_partial_config" src tests docs
```

Expected: no active `.sight.json` reader remains. Compatibility mapper names should be removed or limited to a deliberate re-export with no JSON-file loading semantics.

- [ ] **Step 3: Run a local review diff**

Run:

```bash
BASE_SHA=$(cat /tmp/sight-toml-base-sha)
git diff "$BASE_SHA"..HEAD -- src/config-file src/server-factory.ts src/server-handlers.ts client/src/extension.ts docs/configuration.md tests
```

Expected: diff shows only the planned config-file feature and docs/test updates.

- [ ] **Step 4: Request code review before merge**

Use the review workflow with:

```text
DESCRIPTION: Implemented shared sight.toml project config discovery/loading/merge and LSP reload.
PLAN_OR_REQUIREMENTS: docs/superpowers/plans/2026-06-21-sight-toml-config.md and docs/superpowers/specs/2026-06-21-sight-toml-config-design.md
BASE_SHA: the SHA stored in /tmp/sight-toml-base-sha
HEAD_SHA: current HEAD
```

Expected: reviewer returns no Critical or Important issues. Fix any Critical or Important findings before continuing.

- [ ] **Step 5: Final commit if review fixes were needed**

If review fixes changed files, run:

```bash
git add <changed files>
git commit -m "Address sight.toml config review"
```

Expected: working tree clean except for unrelated user changes.
