/**
 * Directive Parser for Cross-File Awareness
 *
 * Parses @lsp-done-by and @lsp-included-by directives from file headers.
 */

import * as path from 'path';
import * as fs from 'fs';
import { Range } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import {
    Directive,
    CallSite,
    DirectiveParseResult,
    DirectiveDiagnostic,
    DeclarationDirective,
    ForwardCallDirective,
    WorkingDirectoryDirective,
    Token,
} from '../types';
import {
    get_line_text,
    get_line_count,
    compute_line_offsets,
    DocumentLike,
} from '../utils/line-utils';
import { build_do_include_pattern } from '../utils/stata-call-patterns';
import {
    block_comment_lines,
    block_comment_ranges,
    position_in_block_comment,
} from '../utils/block-comment-utils';
import {
    BACKWARD_DIRECTIVE_KEYWORDS,
    FORWARD_DIRECTIVE_KEYWORDS,
    WORKING_DIR_DIRECTIVE_KEYWORDS,
    DECLARATION_DIRECTIVE_KEYWORDS,
    CALL_SITE_PARAMS_FRAGMENT,
    make_directive_pattern,
    has_ignore_directive,
    has_ignore_next_directive,
} from '../utils/directives';

// Accept both spec form with colon (@lsp-done-by:) and legacy form without colon.
// Accept both quoted and unquoted paths.
// @lsp-run-by is a synonym for @lsp-done-by (semantic clarity for files called via `run` command)
// Capture group wraps the shared params fragment so callers can read the raw
// param tail from the match (e.g. `my_match[4]`).
const CALL_SITE_PARAMS_PATTERN = String.raw`(${CALL_SITE_PARAMS_FRAGMENT})\s*$`;

const DIRECTIVE_PATTERN = make_directive_pattern(
    BACKWARD_DIRECTIVE_KEYWORDS,
    String.raw`:?\s+(?:"([^"]+)"|([^\s]+))${CALL_SITE_PARAMS_PATTERN}`,
);

// Detects a standalone backward-directive head (keyword present but the full
// DIRECTIVE_PATTERN did not match) so the parser can report it as malformed.
// Hoisted to module scope so it is not recompiled on every header line. The
// `(?=:|\s|$)` boundary keeps the keyword whole — it matches `done-by:"x"`
// (no space) and `done-by` alone, but not words like `done-bytes`.
const BACKWARD_DIRECTIVE_HEAD_PATTERN = make_directive_pattern(
    BACKWARD_DIRECTIVE_KEYWORDS,
    String.raw`(?=:|\s|$)`,
);

const FORWARD_CALL_DIRECTIVE_PATTERN = make_directive_pattern(
    FORWARD_DIRECTIVE_KEYWORDS,
    String.raw`:?\s+(?:"([^"]+)"|([^\s]+))${CALL_SITE_PARAMS_PATTERN}`,
);

// Detects a standalone forward-directive head (keyword present but the full
// FORWARD_CALL_DIRECTIVE_PATTERN did not match) so the parser can report it as
// malformed, mirroring BACKWARD_DIRECTIVE_HEAD_PATTERN. The `(?=:|\s|$)` boundary
// keeps the keyword whole: it matches `do:"x"` (no space) and `do` alone, but
// not words like `doctor`.
const FORWARD_CALL_DIRECTIVE_HEAD_PATTERN = make_directive_pattern(
    FORWARD_DIRECTIVE_KEYWORDS,
    String.raw`(?=:|\s|$)`,
);

// Pattern for working directory directive with all synonyms
// Matches: @lsp-working-directory, @lsp-working-dir, @lsp-current-directory, @lsp-current-dir, @lsp-cd, @lsp-wd
const WORKING_DIR_DIRECTIVE_PATTERN = make_directive_pattern(
    WORKING_DIR_DIRECTIVE_KEYWORDS,
    String.raw`:?\s+(?:"([^"]+)"|([^\s]+))\s*$`,
);

const PARAM_LINE = /line=(\d+)/;
// Capture the non-empty `match=` string body, allowing an escaped quote `\"` so
// `match="do \"x\""` yields the raw value `do \"x\"` (unescaped in parse_call_site).
const PARAM_MATCH = /match="((?:\\"|[^"])+)"/;

// Head pattern to match declaration directives: @lsp-(local|global|scalar|matrix|program)
// Captures: [1] = directive type. The declared names (rest of line) are sliced
// from the remainder after the match. A `(?=\s|$)` lookahead keeps the keyword a
// whole word (so `@lsp-localx` is not matched) without a trailing `.*$` group,
// which would otherwise trigger a CodeQL polynomial-ReDoS finding. Named
// `_HEAD_` (cf. BACKWARD_DIRECTIVE_HEAD_PATTERN) to distinguish it from the
// name-capturing DECLARATION_DIRECTIVE_PATTERN exported by utils/directives.ts.
const DECLARATION_DIRECTIVE_HEAD_PATTERN = make_directive_pattern(
    DECLARATION_DIRECTIVE_KEYWORDS,
    String.raw`:?(?=\s|$)`,
);

// Shared pattern to match do/include/run statements with optional prefix
// commands, capturing the called path. Prefix alternatives live in
// utils/stata-call-patterns. The scope-resolver classifies call lines via
// classify_call_line() in this module, so there is no separate copy to keep in
// lockstep.
const DO_INCLUDE_PATTERN = build_do_include_pattern('capture');

// Forward-call directives (@lsp-do/run/include, sight: do/run/include) in
// comments are matched with FORWARD_CALL_DIRECTIVE_PATTERN above; the inference
// scanners and classify_call_line share that single constant.

function looks_like_unquoted_path_token(token: string): boolean {
    // Heuristic for valid unquoted paths:
    // - Reject things that look like parameters (line=..., match="...")
    // - Accept paths with file extension (contains '.') or path separator ('/')
    // - Accept bare words that could be Stata file references (e.g., "apple" → "apple.do")
    //   as long as they don't look like parameters
    const lower = token.toLowerCase();

    if (lower.startsWith('line=') || lower.startsWith('match=')) {
        return false;
    }

    // Accept the token - resolve_path_with_fallback will try appending .do
    // if the exact path doesn't exist. This allows:
    // - "../parent.do", "file.do", "./script" (explicit paths)
    // - "apple", "parent" (bare words that resolve to apple.do, parent.do)
    return true;
}

export class DirectiveParser {
    /**
     * Parse directives from file content.
     * Stops at first non-comment, non-blank line.
     */
    parse(content: string, file_uri: string, tokens?: Token[]): DirectiveParseResult {
        const doc: DocumentLike = { content, line_offsets: compute_line_offsets(content) };
        const line_count = get_line_count(doc);
        const the_directives: Directive[] = [];
        const the_diagnostics: DirectiveDiagnostic[] = [];
        const containing_dir = path.dirname(URI.parse(file_uri).fsPath);

        // Track working directory directives (last one wins)
        let working_directory: WorkingDirectoryDirective | undefined;
        let working_dir_count = 0;

        // Continuation lines of multi-line comments carry no directives.
        const block_lines = block_comment_lines(content, tokens);

        for (let i = 0; i < line_count; i++) {
            if (block_lines.has(i)) {
                continue;
            }
            const my_line = get_line_text(doc, i);
            const my_trimmed = my_line.trim();

            // Stop at first non-comment, non-blank line
            if (my_trimmed !== '' &&
                !my_trimmed.startsWith('*') &&
                !my_trimmed.startsWith('//')) {
                break;
            }

            // Only consider directives in comment lines
            if (!my_trimmed.startsWith('*') && !my_trimmed.startsWith('//')) {
                continue;
            }

            // Check for working directory directive first
            const my_wd_match = my_trimmed.match(WORKING_DIR_DIRECTIVE_PATTERN);
            if (my_wd_match) {
                const my_directive_form = my_wd_match[1];
                const my_quoted_path = my_wd_match[2] as string | undefined;
                const my_unquoted_path = my_wd_match[3] as string | undefined;
                const my_raw_path = (my_quoted_path || my_unquoted_path) as string;

                const my_range = {
                    start: { line: i, character: 0 },
                    end: { line: i, character: my_line.length },
                };

                // Check if path starts with / (workspace-relative)
                const is_workspace_relative = my_raw_path.startsWith('/');

                // Resolve the path
                // For workspace-relative paths, we store the path as-is (resolution happens later with workspace root)
                // For relative paths, resolve relative to script's containing directory
                let resolved_path: string;
                if (is_workspace_relative) {
                    // Store without leading slash for later resolution
                    resolved_path = my_raw_path.substring(1);
                } else {
                    resolved_path = this.resolve_path(my_raw_path, containing_dir);
                }

                working_dir_count++;
                working_directory = {
                    path: my_raw_path,
                    resolved_path,
                    is_workspace_relative,
                    range: my_range,
                    directive_form: my_directive_form,
                };
                continue;
            }

            const my_match = my_trimmed.match(DIRECTIVE_PATTERN);
            if (my_match) {
                // Map 'run-by' to 'done-by' (synonym for semantic clarity)
                const my_type_raw = my_match[1] as 'done-by' | 'run-by' | 'included-by';
                const my_type = my_type_raw === 'run-by' ? 'done-by' : my_type_raw;
                const my_quoted_path = my_match[2] as string | undefined;
                const my_unquoted_path = my_match[3] as string | undefined;
                const my_raw_path = (my_quoted_path || my_unquoted_path) as string;
                const my_params = my_match[4]?.trim() ?? '';

                // If the path is unquoted, require that it resembles a path token.
                // This keeps malformed cases like "@lsp-done-by missing-quotes" from being
                // treated as valid while still allowing ../parent and other relative paths.
                if (!my_quoted_path && my_unquoted_path && !looks_like_unquoted_path_token(my_unquoted_path)) {
                    the_diagnostics.push({
                        message: 'Malformed directive. Expected: ' +
                            '// sight: done-by: "path.do" or // sight: run-by: "path.do" or // sight: included-by: "path.do"',
                        range: {
                            start: { line: i, character: 0 },
                            end: { line: i, character: my_line.length },
                        },
                        severity: 'warning',
                    });
                    continue;
                }

                const my_resolved_path = this.resolve_path_with_fallback(
                    my_raw_path,
                    containing_dir
                );

                const my_call_site = this.parse_call_site(my_params);

                const my_range: Range = {
                    start: { line: i, character: 0 },
                    end: { line: i, character: my_line.length },
                };

                the_directives.push({
                    type: my_type,
                    path: my_resolved_path,
                    raw_path: my_raw_path,
                    call_site: my_call_site,
                    range: my_range,
                });
            } else if (BACKWARD_DIRECTIVE_HEAD_PATTERN.test(my_trimmed)) {
                // Malformed directive
                the_diagnostics.push({
                    message: 'Malformed directive. Expected: ' +
                        '// sight: done-by "path" or // sight: run-by "path" or // sight: included-by "path"',
                    range: {
                        start: { line: i, character: 0 },
                        end: { line: i, character: my_line.length },
                    },
                    severity: 'warning',
                });
            }
        }

        // Parse declaration directives from the entire file (not just header)
        const declaration_result = this.parse_declaration_directives(content, file_uri, tokens);
        the_diagnostics.push(...declaration_result.diagnostics);

        // Parse forward call directives from the entire file
        const forward_call_result = this.parse_forward_call_directives(content, file_uri, tokens);
        the_diagnostics.push(...forward_call_result.diagnostics);

        // Emit warning if multiple working directory directives were found
        if (working_dir_count > 1 && working_directory) {
            the_diagnostics.push({
                message: 'Multiple working directory directives found; using the last one',
                range: working_directory.range,
                severity: 'warning',
            });
        }

        return {
            directives: the_directives,
            declaration_directives: declaration_result.declarations,
            forward_calls: forward_call_result.forward_calls,
            working_directory,
            diagnostics: the_diagnostics,
        };
    }

    /**
     * Parse forward call directives from entire file content.
     * Scans the entire file for @lsp-do, @lsp-run, @lsp-include directives.
     * Respects standalone @lsp-ignore / @lsp-ignore-next comment lines, which
     * suppress the next statement.
     *
     * @param content - The file content to parse
     * @param _file_uri - The URI of the file (unused; kept for parity
     *   with the other directive-parser entry points)
     * @returns Object containing forward calls and diagnostics
     */
    parse_forward_call_directives(
        content: string,
        _file_uri: string,
        tokens?: Token[]
    ): { forward_calls: ForwardCallDirective[]; diagnostics: DirectiveDiagnostic[] } {
        const doc: DocumentLike = { content, line_offsets: compute_line_offsets(content) };
        const line_count = get_line_count(doc);
        const the_forward_calls: ForwardCallDirective[] = [];
        const the_diagnostics: DirectiveDiagnostic[] = [];

        // Lines whose leading text is inside a block comment carry no directives.
        const block_lines = block_comment_lines(content, tokens);

        // Track lines to ignore from @lsp-ignore-next
        const ignored_next_lines = new Set<number>();

        // First pass: find @lsp-ignore-next directives
        for (let i = 0; i < line_count; i++) {
            if (block_lines.has(i)) {
                continue;
            }
            const my_line = get_line_text(doc, i);
            const my_trimmed = my_line.trim();

            if ((my_trimmed.startsWith('*') || my_trimmed.startsWith('//')) &&
                (has_ignore_directive(my_trimmed) || has_ignore_next_directive(my_trimmed))) {
                // Mark the next non-blank, non-comment line as ignored
                for (let j = i + 1; j < line_count; j++) {
                    if (block_lines.has(j)) {
                        continue; // block-commented-out line is not a target
                    }
                    const next_trimmed = get_line_text(doc, j).trim();
                    if (next_trimmed !== '' &&
                        !next_trimmed.startsWith('*') &&
                        !next_trimmed.startsWith('//')) {
                        // This is a code line, mark it
                        ignored_next_lines.add(j);
                        break;
                    }
                    // If it's a comment line with a forward call directive, mark it
                    if ((next_trimmed.startsWith('*') || next_trimmed.startsWith('//')) &&
                        FORWARD_CALL_DIRECTIVE_PATTERN.test(next_trimmed)) {
                        ignored_next_lines.add(j);
                        break;
                    }
                }
            }
        }

        for (let i = 0; i < line_count; i++) {
            if (block_lines.has(i)) {
                continue;
            }
            const my_line = get_line_text(doc, i);
            const my_trimmed = my_line.trim();

            // Only consider comment lines
            if (!my_trimmed.startsWith('*') && !my_trimmed.startsWith('//')) {
                continue;
            }

            const my_match = my_trimmed.match(FORWARD_CALL_DIRECTIVE_PATTERN);
            if (my_match) {
                // @lsp-ignore/@lsp-ignore-next from preceding directive line
                if (ignored_next_lines.has(i)) {
                    continue;
                }

                const my_type = my_match[1] as 'do' | 'run' | 'include';
                const my_quoted_path = my_match[2];
                const my_unquoted_path = my_match[3];
                const my_raw_path = my_quoted_path || my_unquoted_path;
                const my_params = my_match[4]?.trim() ?? '';

                if (!my_raw_path) {
                    the_diagnostics.push({
                        message: 'Forward call directive requires a path',
                        range: { start: { line: i, character: 0 }, end: { line: i, character: my_line.length } },
                        severity: 'warning',
                    });
                    continue;
                }

                // If the path is unquoted, require that it resembles a path token.
                // Reject parameter-like tokens (line=..., match=...).
                if (!my_quoted_path && my_unquoted_path && !looks_like_unquoted_path_token(my_unquoted_path)) {
                    the_diagnostics.push({
                        message: 'Malformed directive. Expected: ' +
                            '// sight: do: "path.do" or // sight: run: "path.do" or // sight: include: "path.do"',
                        range: { start: { line: i, character: 0 }, end: { line: i, character: my_line.length } },
                        severity: 'warning',
                    });
                    continue;
                }

                const my_call_site = this.parse_call_site(my_params);
                const my_range: Range = {
                    start: { line: i, character: 0 },
                    end: { line: i, character: my_line.length },
                };

                // Determine call_site_line from params or default to directive line
                let my_call_site_line = i;
                if (my_call_site?.type === 'line' && typeof my_call_site.value === 'number') {
                    // line= is 1-indexed in directive, convert to 0-indexed and clamp
                    my_call_site_line = Math.max(0, my_call_site.value - 1);
                } else if (my_call_site?.type === 'match' && typeof my_call_site.value === 'string') {
                    // Search current file content for match string (reuse the
                    // already-lexed tokens for block-comment span detection).
                    const match_line = this.find_match_line(
                        content, my_call_site.value, block_comment_ranges(content, tokens));
                    if (match_line !== undefined) {
                        my_call_site_line = match_line;
                    } else {
                        // match= not found - emit warning and use directive line
                        the_diagnostics.push({
                            message: `match="${my_call_site.value}" not found; using directive line as call site`,
                            range: my_range,
                            severity: 'warning',
                        });
                    }
                } else if (my_call_site) {
                    // Type mismatch - fall back to directive line and emit warning
                    the_diagnostics.push({
                        message: `Call site type mismatch: expected ${my_call_site.type === 'line' ? 'number' : 'string'} for ${my_call_site.type}=`,
                        range: my_range,
                        severity: 'warning',
                    });
                }

                the_forward_calls.push({
                    type: my_type,
                    raw_path: my_raw_path,
                    call_site_line: my_call_site_line,
                    call_site: my_call_site,
                    range: my_range,
                });
            } else if (!ignored_next_lines.has(i) &&
                FORWARD_CALL_DIRECTIVE_HEAD_PATTERN.test(my_trimmed)) {
                // Forward-directive head present but the full directive did not
                // parse (e.g. missing path or empty match=""). Report it as
                // malformed, mirroring backward directives, so the user is not
                // left guessing why the directive was silently ignored.
                the_diagnostics.push({
                    message: 'Malformed directive. Expected: ' +
                        '// sight: do: "path.do" or // sight: run: "path.do" or // sight: include: "path.do"',
                    range: { start: { line: i, character: 0 }, end: { line: i, character: my_line.length } },
                    severity: 'warning',
                });
            }
        }

        return { forward_calls: the_forward_calls, diagnostics: the_diagnostics };
    }

    /**
     * Parse declaration directives from entire file content.
     * Unlike cross-file directives, these can appear anywhere in the file.
     *
     * Recognizes: @lsp-local, @lsp-global, @lsp-scalar, @lsp-matrix, @lsp-program
     *
     * @param content - The file content to parse
     * @param file_uri - The URI of the file (unused but kept for consistency)
     * @returns Object containing declarations and diagnostics
     */
    parse_declaration_directives(
        content: string,
        _file_uri: string,
        tokens?: Token[]
    ): { declarations: DeclarationDirective[]; diagnostics: DirectiveDiagnostic[] } {
        const doc: DocumentLike = { content, line_offsets: compute_line_offsets(content) };
        const line_count = get_line_count(doc);
        const the_declarations: DeclarationDirective[] = [];
        const the_diagnostics: DirectiveDiagnostic[] = [];

        // Lines whose leading text is inside a block comment carry no directives.
        const block_lines = block_comment_lines(content, tokens);

        for (let i = 0; i < line_count; i++) {
            if (block_lines.has(i)) {
                continue;
            }
            const my_line = get_line_text(doc, i);
            const my_trimmed = my_line.trim();

            // Only consider comment lines
            if (!my_trimmed.startsWith('*') && !my_trimmed.startsWith('//')) {
                continue;
            }

            // Check for declaration directive pattern
            const my_match = my_trimmed.match(DECLARATION_DIRECTIVE_HEAD_PATTERN);
            if (my_match) {
                const my_type = my_match[1] as 'local' | 'global' | 'scalar' | 'matrix' | 'program';
                const my_rest = my_trimmed
                    .slice((my_match.index ?? 0) + my_match[0].length)
                    .trim();

                const my_range: Range = {
                    start: { line: i, character: 0 },
                    end: { line: i, character: my_line.length },
                };

                // Validate at least one argument
                if (my_rest === '') {
                    the_diagnostics.push({
                        message: 'Declaration directive requires at least one argument',
                        range: my_range,
                        severity: 'warning',
                    });
                    continue;
                }

                // Split by whitespace to get all names
                const the_names = my_rest.split(/\s+/).filter(t => t.length > 0);

                for (const my_name of the_names) {
                    the_declarations.push({
                        type: my_type,
                        name: my_name,
                        range: my_range,
                    });
                }
            }
        }

        return { declarations: the_declarations, diagnostics: the_diagnostics };
    }

    /**
     * Parse call site parameters from directive.
     * match= takes precedence over line=.
     */
    private parse_call_site(params: string): CallSite | undefined {
        const my_match_result = params.match(PARAM_MATCH);
        if (my_match_result) {
            // Unescape `\"` so `match="do \"x\""` searches the parent for the
            // literal text `do "x"`. Lone backslashes are left untouched.
            const my_value = my_match_result[1].replace(/\\"/g, '"');
            return { type: 'match', value: my_value };
        }

        const my_line_result = params.match(PARAM_LINE);
        if (my_line_result) {
            return { type: 'line', value: parseInt(my_line_result[1], 10) };
        }

        return undefined;
    }

    /**
     * Resolve a path relative to the containing file's directory.
     *
     * Notes:
     * - Directives may include Windows-style separators (\). Normalize them to
     *   forward slashes first so "a\\b\\..\\c" behaves like "a/b/../c".
     * - If a directive provides a Windows absolute path (e.g., C:\\foo\\bar),
     *   treat it as absolute for normalization purposes.
     */
    resolve_path(raw_path: string, containing_dir: string): string {
        const normalized_separators = raw_path.replace(/\\/g, '/');

        // Treat Windows absolute paths as absolute (even on POSIX hosts).
        // Examples:
        // - C:/path/to/file
        // - //server/share/path (UNC-style)
        if (/^[a-zA-Z]:\//.test(normalized_separators) || normalized_separators.startsWith('//')) {
            return path.posix.normalize(normalized_separators);
        }

        if (path.isAbsolute(normalized_separators)) {
            return path.normalize(normalized_separators);
        }

        return path.normalize(path.join(containing_dir, normalized_separators));
    }

    /**
     * Resolve a path with .do extension fallback.
     * If the exact path doesn't exist, tries appending .do.
     *
     * @param raw_path - The path from the directive
     * @param containing_dir - Directory of the file containing the directive
     * @param file_exists - Function to check file existence (injectable for testing)
     * @returns Resolved absolute path
     */
    resolve_path_with_fallback(
        raw_path: string,
        containing_dir: string,
        file_exists: (path_to_check: string) => boolean = fs.existsSync
    ): string {
        const my_resolved = this.resolve_path(raw_path, containing_dir);

        // If exact path exists, return it
        if (file_exists(my_resolved)) {
            return my_resolved;
        }

        // If path doesn't end in .do, try appending .do
        if (!my_resolved.endsWith('.do')) {
            const my_with_do = my_resolved + '.do';
            if (file_exists(my_with_do)) {
                return my_with_do;
            }
        }

        // Return original resolved path (diagnostic will be emitted elsewhere)
        return my_resolved;
    }

    /**
     * Find the line number for a match= parameter.
     * Returns undefined if not found.
     */
    find_match_line(
        parent_content: string,
        match_string: string,
        block_ranges?: Range[]
    ): number | undefined {
        const doc: DocumentLike = { content: parent_content, line_offsets: compute_line_offsets(parent_content) };
        const line_count = get_line_count(doc);
        // A match= occurrence inside a /* ... */ block comment is inert in Stata,
        // so it must never become a call site. find_match_line does an unanchored
        // substring search, so it checks the POSITION of each occurrence (not the
        // whole line): an inline comment like `display 1 /* do "x" */` must not
        // match, while a real `do "x"` after a `*/` on the same line must. Callers
        // that already computed the ranges can pass them to avoid re-lexing.
        const the_block_ranges = block_ranges ?? block_comment_ranges(parent_content);
        for (let i = 0; i < line_count; i++) {
            const my_text = get_line_text(doc, i);
            // `my_from <= length` bounds the scan: for an empty match_string,
            // indexOf('') returns my_from up to the line length and then clamps,
            // so without this bound the loop would never terminate.
            let my_from = 0;
            while (my_from <= my_text.length) {
                const my_col = my_text.indexOf(match_string, my_from);
                if (my_col < 0) {
                    break;
                }
                if (!position_in_block_comment(i, my_col, the_block_ranges)) {
                    return i; // first non-block-commented occurrence
                }
                my_from = my_col + 1; // a later occurrence on this line may be live
            }
        }
        return undefined;
    }

    /**
     * Classify a single line as a do/run/include call statement, applying the
     * SAME validation as the directive scanners: a real command must carry a
     * path; a forward directive must carry a valid path plus a well-formed
     * line=/match= tail. Returns the call type, or undefined.
     *
     * Does NOT consider block comments — callers must first skip lines inside
     * a /* ... *\/ block (see block_comment_lines), since this operates on a
     * single line with no surrounding context.
     */
    classify_call_line(
        line_content: string
    ): 'do' | 'run' | 'include' | undefined {
        const my_trimmed = line_content.trim();

        // Real do/include/run command — require a path (capture variant),
        // matching infer_call_type_for_file / find_all_call_sites_for_file.
        const command_match = my_trimmed.match(DO_INCLUDE_PATTERN);
        if (command_match) {
            const my_path = command_match[2] || command_match[3];
            if (my_path) {
                return command_match[1] as 'do' | 'run' | 'include';
            }
        }

        // Forward directive in a comment line — full validation (path required
        // plus a well-formed param tail, rejecting param-like unquoted tokens),
        // matching parse_forward_call_directives.
        if (my_trimmed.startsWith('*') || my_trimmed.startsWith('//')) {
            const directive_match = my_trimmed.match(FORWARD_CALL_DIRECTIVE_PATTERN);
            if (directive_match) {
                const my_quoted_path = directive_match[2];
                const my_unquoted_path = directive_match[3];
                const my_path = my_quoted_path || my_unquoted_path;
                if (my_path &&
                    (my_quoted_path ||
                        looks_like_unquoted_path_token(my_unquoted_path))) {
                    return directive_match[1] as 'do' | 'run' | 'include';
                }
            }
        }

        return undefined;
    }

    /**
     * Infer the call site for a child file by scanning the parent content
     * for do, include, or run statements that reference the child file.
     *
     * Handles:
     * - Quoted paths: do "child.do", include "path/child.do"
     * - Unquoted paths: do child.do, run child
     * - With/without .do suffix (case-insensitive for file extension)
     * - Prefix commands: quietly do child.do, cap include child.do, noi run child.do
     * - @lsp-do, @lsp-run, @lsp-include directives in comments
     *
     * Case-sensitivity:
     * - do/include/run keywords must be lowercase (Stata is case-sensitive)
     * - Prefix commands must be lowercase
     * - File extension comparison (.do) is case-insensitive
     * - Filename comparison is case-insensitive (filesystem convention)
     *
     * @param parent_content - The content of the parent file
     * @param child_filename - The filename of the child file (basename only)
     * @returns The 0-indexed line number of the first match, or undefined if not found
     */
    infer_call_site_for_file(
        parent_content: string,
        child_filename: string
    ): number | undefined {
        const doc: DocumentLike = { content: parent_content, line_offsets: compute_line_offsets(parent_content) };
        const line_count = get_line_count(doc);

        // Normalize child filename for comparison (remove .do suffix if present)
        // File extension check is case-insensitive
        const child_basename = path.basename(child_filename);
        const child_without_ext = child_basename.toLowerCase().endsWith('.do')
            ? child_basename.slice(0, -3).toLowerCase()
            : child_basename.toLowerCase();

        // Code and directives whose leading text is inside a block comment are inert.
        const block_lines = block_comment_lines(parent_content);

        for (let i = 0; i < line_count; i++) {
            if (block_lines.has(i)) {
                continue;
            }
            const my_line = get_line_text(doc, i);
            const my_trimmed = my_line.trim();

            // First check for actual do/include/run commands
            const my_match = my_line.match(DO_INCLUDE_PATTERN);

            if (my_match) {
                // Extract the target path (quoted or unquoted)
                const my_quoted_path = my_match[2];
                const my_unquoted_path = my_match[3];
                const my_target_path = my_quoted_path || my_unquoted_path;

                if (my_target_path) {
                    // Get basename of target and normalize for comparison
                    // File extension check is case-insensitive
                    const my_target_basename = path.basename(my_target_path);
                    const my_target_without_ext = my_target_basename.toLowerCase().endsWith('.do')
                        ? my_target_basename.slice(0, -3).toLowerCase()
                        : my_target_basename.toLowerCase();

                    // Compare normalized names (case-insensitive for filenames, ignoring .do suffix)
                    if (my_target_without_ext === child_without_ext) {
                        return i; // 0-indexed line number
                    }
                }
            }

            // Also check for @lsp-do, @lsp-run, @lsp-include directives in comment lines
            if (my_trimmed.startsWith('*') || my_trimmed.startsWith('//')) {
                const directive_match = my_trimmed.match(FORWARD_CALL_DIRECTIVE_PATTERN);
                if (directive_match) {
                    const my_quoted_path = directive_match[2];
                    const my_unquoted_path = directive_match[3];
                    const my_target_path = my_quoted_path || my_unquoted_path;

                    // Reject param-like unquoted tokens (line=.../match=...),
                    // matching parse_forward_call_directives, so a directive like
                    // `// sight: do line=5` is not mis-read as a call to a
                    // pathologically-named child such as `line=5.do`.
                    if (my_target_path &&
                        (my_quoted_path ||
                            looks_like_unquoted_path_token(my_unquoted_path))) {
                        const my_target_basename = path.basename(my_target_path);
                        const my_target_without_ext = my_target_basename.toLowerCase().endsWith('.do')
                            ? my_target_basename.slice(0, -3).toLowerCase()
                            : my_target_basename.toLowerCase();

                        if (my_target_without_ext === child_without_ext) {
                            return i; // 0-indexed line number
                        }
                    }
                }
            }
        }

        return undefined;
    }

    /**
     * Infer the call site and call type for a child file by scanning the parent content
     * for do, include, or run statements that reference the child file.
     *
     * @param parent_content - The content of the parent file
     * @param child_filename - The filename of the child file (basename only)
     * @returns Object with line number and call type, or undefined if not found
     */
    infer_call_type_for_file(
        parent_content: string,
        child_filename: string
    ): { line: number; call_type: 'do' | 'run' | 'include' } | undefined {
        const doc: DocumentLike = { content: parent_content, line_offsets: compute_line_offsets(parent_content) };
        const line_count = get_line_count(doc);

        // Normalize child filename for comparison (remove .do suffix if present)
        // File extension check is case-insensitive
        const child_basename = path.basename(child_filename);
        const child_without_ext = child_basename.toLowerCase().endsWith('.do')
            ? child_basename.slice(0, -3).toLowerCase()
            : child_basename.toLowerCase();

        // Code and directives whose leading text is inside a block comment are inert.
        const block_lines = block_comment_lines(parent_content);

        for (let i = 0; i < line_count; i++) {
            if (block_lines.has(i)) {
                continue;
            }
            const my_line = get_line_text(doc, i);
            const my_trimmed = my_line.trim();

            // First check for actual do/include/run commands
            const my_match = my_line.match(DO_INCLUDE_PATTERN);

            if (my_match) {
                const my_call_type = my_match[1] as 'do' | 'include' | 'run';
                // Extract the target path (quoted or unquoted)
                const my_quoted_path = my_match[2];
                const my_unquoted_path = my_match[3];
                const my_target_path = my_quoted_path || my_unquoted_path;

                if (my_target_path) {
                    // Get basename of target and normalize for comparison
                    // File extension check is case-insensitive
                    const my_target_basename = path.basename(my_target_path);
                    const my_target_without_ext = my_target_basename.toLowerCase().endsWith('.do')
                        ? my_target_basename.slice(0, -3).toLowerCase()
                        : my_target_basename.toLowerCase();

                    // Compare normalized names (case-insensitive for filenames, ignoring .do suffix)
                    if (my_target_without_ext === child_without_ext) {
                        return { line: i, call_type: my_call_type }; // 0-indexed line number
                    }
                }
            }

            // Also check for @lsp-do, @lsp-run, @lsp-include directives in comment lines
            if (my_trimmed.startsWith('*') || my_trimmed.startsWith('//')) {
                const directive_match = my_trimmed.match(FORWARD_CALL_DIRECTIVE_PATTERN);
                if (directive_match) {
                    const my_call_type = directive_match[1] as 'do' | 'run' | 'include';
                    const my_quoted_path = directive_match[2];
                    const my_unquoted_path = directive_match[3];
                    const my_target_path = my_quoted_path || my_unquoted_path;

                    // Reject param-like unquoted tokens (line=.../match=...),
                    // matching parse_forward_call_directives, so a directive like
                    // `// sight: do line=5` is not mis-read as a call to a
                    // pathologically-named child such as `line=5.do`.
                    if (my_target_path &&
                        (my_quoted_path ||
                            looks_like_unquoted_path_token(my_unquoted_path))) {
                        const my_target_basename = path.basename(my_target_path);
                        const my_target_without_ext = my_target_basename.toLowerCase().endsWith('.do')
                            ? my_target_basename.slice(0, -3).toLowerCase()
                            : my_target_basename.toLowerCase();

                        if (my_target_without_ext === child_without_ext) {
                            return { line: i, call_type: my_call_type };
                        }
                    }
                }
            }
        }

        return undefined;
    }

    /**
     * Find all call sites for a child file in the parent content.
     * Unlike infer_call_type_for_file() which returns the first match,
     * this method collects ALL matching call sites.
     *
     * Handles:
     * - Quoted paths: do "child.do", include "path/child.do"
     * - Unquoted paths: do child.do, run child
     * - With/without .do suffix (case-insensitive for file extension)
     * - Prefix commands: quietly do child.do, cap include child.do, noi run child.do
     * - @lsp-do, @lsp-run, @lsp-include directives in comments
     *
     * Case-sensitivity:
     * - do/include/run keywords must be lowercase (Stata is case-sensitive)
     * - Prefix commands must be lowercase
     * - File extension comparison (.do) is case-insensitive
     * - Filename comparison is case-insensitive (filesystem convention)
     *
     * @param parent_content - Content of the parent file
     * @param child_filename - Filename of the child file (basename only)
     * @returns Array of { line: number; call_type: 'do' | 'run' | 'include' }
     */
    find_all_call_sites_for_file(
        parent_content: string,
        child_filename: string
    ): Array<{ line: number; call_type: 'do' | 'run' | 'include' }> {
        const doc: DocumentLike = { content: parent_content, line_offsets: compute_line_offsets(parent_content) };
        const line_count = get_line_count(doc);
        const the_call_sites: Array<{ line: number; call_type: 'do' | 'run' | 'include' }> = [];

        // Normalize child filename for comparison (remove .do suffix if present)
        // File extension check is case-insensitive
        const child_basename = path.basename(child_filename);
        const child_without_ext = child_basename.toLowerCase().endsWith('.do')
            ? child_basename.slice(0, -3).toLowerCase()
            : child_basename.toLowerCase();

        // Code and directives whose leading text is inside a block comment are inert.
        const block_lines = block_comment_lines(parent_content);

        for (let i = 0; i < line_count; i++) {
            if (block_lines.has(i)) {
                continue;
            }
            const my_line = get_line_text(doc, i);
            const my_trimmed = my_line.trim();

            // First check for actual do/include/run commands
            const my_match = my_line.match(DO_INCLUDE_PATTERN);

            if (my_match) {
                const my_call_type = my_match[1] as 'do' | 'include' | 'run';
                // Extract the target path (quoted or unquoted)
                const my_quoted_path = my_match[2];
                const my_unquoted_path = my_match[3];
                const my_target_path = my_quoted_path || my_unquoted_path;

                if (my_target_path) {
                    // Get basename of target and normalize for comparison
                    // File extension check is case-insensitive
                    const my_target_basename = path.basename(my_target_path);
                    const my_target_without_ext = my_target_basename.toLowerCase().endsWith('.do')
                        ? my_target_basename.slice(0, -3).toLowerCase()
                        : my_target_basename.toLowerCase();

                    // Compare normalized names (case-insensitive for filenames, ignoring .do suffix)
                    if (my_target_without_ext === child_without_ext) {
                        the_call_sites.push({ line: i, call_type: my_call_type });
                    }
                }
            }

            // Also check for @lsp-do, @lsp-run, @lsp-include directives in comment lines
            if (my_trimmed.startsWith('*') || my_trimmed.startsWith('//')) {
                const directive_match = my_trimmed.match(FORWARD_CALL_DIRECTIVE_PATTERN);
                if (directive_match) {
                    const my_call_type = directive_match[1] as 'do' | 'run' | 'include';
                    const my_quoted_path = directive_match[2];
                    const my_unquoted_path = directive_match[3];
                    const my_target_path = my_quoted_path || my_unquoted_path;

                    // Reject param-like unquoted tokens (line=.../match=...),
                    // matching parse_forward_call_directives, so a directive like
                    // `// sight: do line=5` is not mis-read as a call to a
                    // pathologically-named child such as `line=5.do`.
                    if (my_target_path &&
                        (my_quoted_path ||
                            looks_like_unquoted_path_token(my_unquoted_path))) {
                        const my_target_basename = path.basename(my_target_path);
                        const my_target_without_ext = my_target_basename.toLowerCase().endsWith('.do')
                            ? my_target_basename.slice(0, -3).toLowerCase()
                            : my_target_basename.toLowerCase();

                        if (my_target_without_ext === child_without_ext) {
                            the_call_sites.push({ line: i, call_type: my_call_type });
                        }
                    }
                }
            }
        }

        return the_call_sites;
    }
}
