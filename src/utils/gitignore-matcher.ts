import * as fs from 'fs';
import * as path from 'path';
import ignore, { type Ignore } from 'ignore';
import { logger } from './logger';

export interface GitignoreWatchDirectory {
    directory: string;
    recursive: boolean;
}

export interface GitignoreMatcher {
    is_ignored(
        absolute_path: string,
        kind: 'file' | 'directory'
    ): boolean;
    readonly watch_directories: readonly GitignoreWatchDirectory[];
}

interface DirectoryContext {
    rule_root: string;
    ignored: boolean;
    rules: Ignore;
}

interface WorkspaceScope {
    workspace_root: string;
    rule_root: string;
    directories: Map<string, DirectoryContext>;
}

const DISABLED_MATCHER: GitignoreMatcher = {
    is_ignored: () => false,
    watch_directories: [],
};

const IGNORE_LINE_BREAK = /\r?\n/;
const BLANK_PATTERN = /^\s*$/;
const TRAILING_PATTERN_WHITESPACE = /\s+$/;
const MIDDLE_SLASH = /\/(?!$)/;
const LITERAL_DIRECTORY_METACHARACTERS = /[\\*[\]]/g;
const ESCAPED_PATTERN_PREFIX = /^\\([!#])/;

/**
 * Give nested patterns their original directory scope inside one matcher.
 * Combining the hierarchy lets node-ignore apply directory re-inclusions
 * before testing descendants, including re-inclusions from deeper files.
 */
function rebase_patterns(content: string, relative_directory: string): string[] {
    // Remove a file's UTF-8 BOM before adding a directory prefix, which
    // would otherwise turn it into a literal character inside a pattern.
    const pattern_content = content.startsWith('\uFEFF')
        ? content.slice(1)
        : content;
    const the_lines = pattern_content.split(IGNORE_LINE_BREAK);
    if (relative_directory === '') return the_lines;

    // node-ignore cannot match an escaped literal question mark. Leave
    // it as a one-character wildcard in this prefix: the manager is
    // queried only within this exact directory, so its prefix never
    // sees a sibling path and cannot broaden the rule's scope.
    LITERAL_DIRECTORY_METACHARACTERS.lastIndex = 0;
    const prefix = relative_directory.replace(
        LITERAL_DIRECTORY_METACHARACTERS, '\\$&'
    );
    const the_patterns: string[] = [];
    for (const my_line of the_lines) {
        if (BLANK_PATTERN.test(my_line) || my_line.startsWith('#')) continue;
        const negative = my_line.startsWith('!');
        const body = negative ? my_line.slice(1) : my_line;
        // Whitespace is removed only to classify a trailing slash. Pass
        // the original body to node-ignore so escaped spaces stay intact.
        const shape = body.replace(TRAILING_PATTERN_WHITESPACE, '');
        if (shape === '' || shape === '/') continue;
        const anchored = body.startsWith('/') || MIDDLE_SLASH.test(shape);
        const relative_pattern = (body.startsWith('/') ? body.slice(1) : body)
            .replace(ESCAPED_PATTERN_PREFIX, '$1');
        the_patterns.push(
            `${negative ? '!' : ''}/${prefix}/` +
            `${anchored ? '' : '**/'}${relative_pattern}`
        );
    }
    return the_patterns;
}

function is_missing(error: unknown): boolean {
    return typeof error === 'object' && error !== null &&
        'code' in error &&
        (error.code === 'ENOENT' || error.code === 'ENOTDIR');
}

function contains_path(root: string, target: string): boolean {
    const relative = path.relative(root, target);
    return relative !== '..' &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative);
}

/**
 * Snapshot of workspace Gitignore rules, loaded lazily per directory.
 * Recreate after ignore-file or workspace changes. No Git executable or
 * Git configuration is consulted, and external ADO paths are unaffected.
 *
 * Rule discovery starts at the nearest ancestor repository marker, or
 * at the workspace root when no marker exists. Nested repositories do
 * not interrupt a selected workspace's hierarchy. Selecting a nested
 * repository as another workspace establishes its own rule scope.
 */
export function create_gitignore_matcher(
    workspace_roots: readonly string[],
    respect_gitignore: boolean = true
): GitignoreMatcher {
    if (!respect_gitignore || workspace_roots.length === 0) {
        return DISABLED_MATCHER;
    }

    let warned = false;
    function warn_unreadable(file_path: string, error: unknown): void {
        if (warned || is_missing(error)) return;
        warned = true;
        const detail = error instanceof Error ? error.message : String(error);
        logger.warn(
            `Cannot read Gitignore rules at ${file_path}: ${detail}. ` +
            'Continuing with the available rules.'
        );
    }

    function find_rule_root(workspace_root: string): string {
        let directory = workspace_root;
        while (true) {
            const marker_path = path.join(directory, '.git');
            try {
                const marker = fs.lstatSync(marker_path);
                if (marker.isDirectory() || marker.isFile()) return directory;
            } catch (error) {
                warn_unreadable(marker_path, error);
            }
            const parent = path.dirname(directory);
            if (parent === directory) return workspace_root;
            directory = parent;
        }
    }

    function read_rules(
        scope: WorkspaceScope,
        directory: string,
        inherited_rules: Ignore | undefined
    ): Ignore {
        const ignore_path = path.join(directory, '.gitignore');
        try {
            // Git does not follow .gitignore symlinks. Directory entries
            // named .gitignore also contribute no rules.
            if (fs.lstatSync(ignore_path).isFile()) {
                const content = fs.readFileSync(ignore_path, 'utf8');
                const relative_directory = path.relative(
                    scope.rule_root, directory
                ).split(path.sep).join('/');
                // These are path patterns, not Stata syntax. Keep matching
                // deterministic across filesystems without reading Git config.
                return ignore({ ignorecase: false })
                    .add(inherited_rules ?? [])
                    .add(rebase_patterns(content, relative_directory));
            }
        } catch (error) {
            warn_unreadable(ignore_path, error);
        }
        // Most directories have no ignore file; share the inherited
        // compiled rules rather than copying them for every directory.
        return inherited_rules ?? ignore({ ignorecase: false });
    }

    function matches_rules(
        context: DirectoryContext,
        absolute_path: string,
        kind: 'file' | 'directory'
    ): boolean {
        // The parent directory must already be reachable. A negation in
        // its own ignore file cannot reopen an ignored ancestor.
        if (context.ignored) return true;
        const relative = path.relative(
            context.rule_root, absolute_path
        ).split(path.sep).join('/');
        return context.rules.ignores(
            kind === 'directory' ? `${relative}/` : relative
        );
    }

    function directory_context(
        scope: WorkspaceScope,
        directory: string
    ): DirectoryContext {
        const cached = scope.directories.get(directory);
        if (cached) return cached;

        // path.relative also handles drive-letter/casing equivalence on
        // Windows, where string equality could recurse past the root.
        const parent = path.relative(scope.rule_root, directory) === ''
            ? undefined
            : directory_context(scope, path.dirname(directory));
        const ignored = parent !== undefined &&
            matches_rules(parent, directory, 'directory');
        const context: DirectoryContext = {
            rule_root: scope.rule_root,
            ignored,
            rules: ignored && parent
                ? parent.rules
                : read_rules(scope, directory, parent?.rules),
        };
        scope.directories.set(directory, context);
        return context;
    }

    const the_scopes: WorkspaceScope[] = Array.from(
        new Set(workspace_roots.map(my_root => path.resolve(my_root)))
    ).sort((a, b) => b.length - a.length).map(workspace_root => ({
        workspace_root,
        rule_root: find_rule_root(workspace_root),
        directories: new Map<string, DirectoryContext>(),
    }));
    const the_watch_directories = new Map<string, boolean>();
    for (const my_scope of the_scopes) {
        the_watch_directories.set(my_scope.workspace_root, true);
        let directory = my_scope.workspace_root;
        while (directory !== my_scope.rule_root) {
            directory = path.dirname(directory);
            if (!the_watch_directories.has(directory)) {
                the_watch_directories.set(directory, false);
            }
        }
    }

    return {
        watch_directories: Array.from(
            the_watch_directories,
            ([directory, recursive]) => ({ directory, recursive })
        ),
        is_ignored(absolute_path, kind) {
            const target = path.resolve(absolute_path);
            // The deepest explicitly selected workspace determines the
            // hierarchy. Out-of-workspace paths are never filtered.
            for (const my_scope of the_scopes) {
                if (!contains_path(my_scope.workspace_root, target)) continue;
                if (path.relative(my_scope.workspace_root, target) === '') {
                    return false;
                }
                const context = directory_context(
                    my_scope, path.dirname(target)
                );
                return matches_rules(context, target, kind);
            }
            return false;
        },
    };
}
